import { describe, expect, it } from 'vitest';
import type { StructuredLogger } from '../shared/logger.js';
import { createWebhookDeliveryProcessor } from './delivery-processor.js';
import type {
  ClaimedWebhookDelivery,
  ClaimNextInput,
  WebhookOutboxRepository,
} from './outbox-repository.js';
import type { WebhookSendResult } from './sender.js';

const NOW = new Date('2026-04-01T09:00:00.000Z');

const claimed = (overrides: Partial<ClaimedWebhookDelivery> = {}): ClaimedWebhookDelivery => ({
  id: 'outbox-1',
  workspaceId: 'workspace-1',
  endpointId: 'endpoint-1',
  eventType: 'attendance_request.approved',
  eventId: 'event-1',
  payload: { requestId: 'r1' },
  occurredAt: '2026-04-01T08:00:00.000Z',
  claimToken: 'token-1',
  endpoint: { url: 'https://example.test/hooks', secretHash: 'hash-1' },
  ...overrides,
});

interface LoggedEvent {
  event: string;
  fields: Record<string, unknown>;
}

interface Harness {
  recorded: { workspaceId: string; eventId: string; outcome: string; statusCode: number | null }[];
  completed: { id: string; claimToken: string }[];
  claimInputs: ClaimNextInput[];
  logged: LoggedEvent[];
  processor: ReturnType<typeof createWebhookDeliveryProcessor>;
  sentBodies: string[];
}

function harness(
  entries: ClaimedWebhookDelivery[],
  options: {
    send?: () => Promise<WebhookSendResult>;
    completes?: boolean;
    recordFails?: (eventId: string) => boolean;
  } = {},
): Harness {
  const recorded: Harness['recorded'] = [];
  const completed: Harness['completed'] = [];
  const claimInputs: ClaimNextInput[] = [];
  const logged: LoggedEvent[] = [];
  const sentBodies: string[] = [];
  const queue = [...entries];

  const logger: StructuredLogger = {
    info: (event, fields) => logged.push({ event, fields: fields ?? {} }),
    error: (event, fields) => logged.push({ event, fields: fields ?? {} }),
  };

  const outbox: WebhookOutboxRepository = {
    enqueue: async () => {},
    claimNext: async (input) => {
      claimInputs.push(input);
      return queue.shift() ?? null;
    },
    complete: async (id, claimToken) => {
      completed.push({ id, claimToken });
      return options.completes ?? true;
    },
  };

  const processor = createWebhookDeliveryProcessor({
    outbox,
    deliveries: {
      recordDelivery: async (workspaceId, input) => {
        if (options.recordFails?.(input.eventId) === true) {
          throw new Error('記録できませんでした');
        }
        recorded.push({
          workspaceId,
          eventId: input.eventId,
          outcome: input.outcome,
          statusCode: input.statusCode,
        });
      },
    },
    send:
      options.send ??
      (async (request) => {
        sentBodies.push(request.body);
        return { outcome: 'delivered', statusCode: 204, errorMessage: null };
      }),
    now: () => NOW,
    claimLeaseMs: 60_000,
    logger,
  });

  return { recorded, completed, claimInputs, logged, sentBodies, processor };
}

describe('createWebhookDeliveryProcessor', () => {
  it('送信して結果を記録し、送信待ちを完了させる', async () => {
    const { recorded, completed, sentBodies, processor } = harness([claimed()]);

    expect(await processor.processNext()).toBe(true);
    expect(recorded).toEqual([
      { workspaceId: 'workspace-1', eventId: 'event-1', outcome: 'delivered', statusCode: 204 },
    ]);
    expect(completed).toEqual([{ id: 'outbox-1', claimToken: 'token-1' }]);

    // 本文には出来事が起きた時刻を入れる。送信を試みた時刻は署名のヘッダーで伝える。
    expect(JSON.parse(sentBodies[0] ?? '{}')).toEqual({
      eventId: 'event-1',
      eventType: 'attendance_request.approved',
      occurredAt: '2026-04-01T08:00:00.000Z',
      data: { requestId: 'r1' },
    });
  });

  it('排他の基準時刻を渡さない', async () => {
    const { claimInputs, processor } = harness([claimed()]);

    await processor.processNext();

    // 取得可否と占有期限は PostgreSQL が決める。ワーカーの時計は渡さない。
    expect(claimInputs).toEqual([{ leaseMs: 60_000 }]);
  });

  it('1 回の呼び出しで取得するのは 1 件だけ', async () => {
    const state = harness([claimed(), claimed({ id: 'outbox-2', eventId: 'event-2' })]);

    await state.processor.processNext();

    // 未送信の行を先取りしない。先取りすると送信前に占有期限が切れる。
    expect(state.claimInputs).toHaveLength(1);
    expect(state.completed.map((entry) => entry.id)).toEqual(['outbox-1']);
  });

  it('送信待ちが無ければ false を返す', async () => {
    const { processor, completed } = harness([]);

    expect(await processor.processNext()).toBe(false);
    expect(completed).toEqual([]);
  });

  it('送信先が止まっていれば送信せずに記録だけ残す', async () => {
    const { recorded, completed, sentBodies, processor } = harness([claimed({ endpoint: null })]);

    await processor.processNext();

    expect(sentBodies).toEqual([]);
    expect(recorded[0]?.outcome).toBe('skipped');
    expect(completed.map((entry) => entry.id)).toEqual(['outbox-1']);
  });

  it('送信に失敗しても結果を記録して完了させる', async () => {
    const { recorded, completed, processor } = harness([claimed()], {
      send: async () => ({ outcome: 'failed', statusCode: 500, errorMessage: 'HTTP 500' }),
    });

    await processor.processNext();

    expect(recorded[0]).toMatchObject({ outcome: 'failed', statusCode: 500 });
    expect(completed.map((entry) => entry.id)).toEqual(['outbox-1']);
  });

  it('取得の印が一致せず完了できなくても例外にしない', async () => {
    const { processor } = harness([claimed()], { completes: false });

    await expect(processor.processNext()).resolves.toBe(true);
  });

  it('1 件の失敗で次の送信を止めない', async () => {
    const { recorded, processor } = harness(
      [claimed(), claimed({ id: 'outbox-2', eventId: 'event-2' })],
      { recordFails: (eventId) => eventId === 'event-1' },
    );

    expect(await processor.processNext()).toBe(true);
    expect(await processor.processNext()).toBe(true);
    expect(recorded.map((entry) => entry.eventId)).toEqual(['event-2']);
  });
});

describe('送信結果のログ', () => {
  const outcomeOf = async (send: () => Promise<WebhookSendResult>): Promise<LoggedEvent> => {
    const { logged, processor } = harness([claimed()], { send });
    await processor.processNext();
    const event = logged[0];
    if (!event) throw new Error('ログが出ていません');
    return event;
  };

  it('送信できた場合', async () => {
    expect(
      await outcomeOf(async () => ({ outcome: 'delivered', statusCode: 204, errorMessage: null })),
    ).toEqual({
      event: 'webhook.delivery_completed',
      fields: {
        outboxId: 'outbox-1',
        eventId: 'event-1',
        eventType: 'attendance_request.approved',
        outcome: 'delivered',
        statusCode: 204,
      },
    });
  });

  it('HTTP が失敗した場合も同じイベント名で outcome だけが変わる', async () => {
    const event = await outcomeOf(async () => ({
      outcome: 'failed',
      statusCode: 500,
      errorMessage: 'HTTP 500',
    }));

    // 失敗を webhook.delivered として数えられないようにする。
    expect(event.event).toBe('webhook.delivery_completed');
    expect(event.fields.outcome).toBe('failed');
  });

  it('送信先が止まっていた場合', async () => {
    const { logged, processor } = harness([claimed({ endpoint: null })]);
    await processor.processNext();

    expect(logged[0]?.event).toBe('webhook.delivery_completed');
    expect(logged[0]?.fields.outcome).toBe('skipped');
  });

  it('処理そのものが失敗した場合は HTTP の失敗と区別する', async () => {
    const { logged, processor } = harness([claimed()], { recordFails: () => true });
    await processor.processNext();

    expect(logged[0]?.event).toBe('webhook.delivery_processing_failed');
    expect(logged.map((entry) => entry.event)).not.toContain('webhook.delivery_completed');
  });

  it('webhook.delivered というイベント名は使わない', async () => {
    const { logged, processor } = harness([claimed()], {
      send: async () => ({ outcome: 'failed', statusCode: 500, errorMessage: 'HTTP 500' }),
    });
    await processor.processNext();

    expect(logged.map((entry) => entry.event)).not.toContain('webhook.delivered');
  });
});
