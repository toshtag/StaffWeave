import { describe, expect, it } from 'vitest';
import { createWebhookDeliveryProcessor } from './delivery-processor.js';
import type { ClaimedWebhookDelivery, WebhookOutboxRepository } from './outbox-repository.js';
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

interface Harness {
  recorded: { workspaceId: string; eventId: string; outcome: string; statusCode: number | null }[];
  completed: string[];
  claims: number;
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
  const completed: string[] = [];
  const sentBodies: string[] = [];
  const queue = [...entries];

  const harnessState = { claims: 0 };
  const outbox: WebhookOutboxRepository = {
    enqueue: async () => {},
    claimNext: async () => {
      harnessState.claims += 1;
      return queue.shift() ?? null;
    },
    complete: async (id) => {
      completed.push(id);
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
  });

  return {
    recorded,
    completed,
    sentBodies,
    processor,
    get claims() {
      return harnessState.claims;
    },
  };
}

describe('createWebhookDeliveryProcessor', () => {
  it('送信して結果を記録し、送信待ちを完了させる', async () => {
    const { recorded, completed, sentBodies, processor } = harness([claimed()]);

    expect(await processor.processNext()).toBe(true);
    expect(recorded).toEqual([
      { workspaceId: 'workspace-1', eventId: 'event-1', outcome: 'delivered', statusCode: 204 },
    ]);
    expect(completed).toEqual(['outbox-1']);

    // 本文には出来事が起きた時刻を入れる。送信を試みた時刻は署名のヘッダーで伝える。
    expect(JSON.parse(sentBodies[0] ?? '{}')).toEqual({
      eventId: 'event-1',
      eventType: 'attendance_request.approved',
      occurredAt: '2026-04-01T08:00:00.000Z',
      data: { requestId: 'r1' },
    });
  });

  it('1 回の呼び出しで取得するのは 1 件だけ', async () => {
    const state = harness([claimed(), claimed({ id: 'outbox-2', eventId: 'event-2' })]);

    await state.processor.processNext();

    // 未送信の行を先取りしない。先取りすると送信前に占有期限が切れる。
    expect(state.claims).toBe(1);
    expect(state.completed).toEqual(['outbox-1']);
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
    expect(completed).toEqual(['outbox-1']);
  });

  it('送信に失敗しても結果を記録して完了させる', async () => {
    const { recorded, completed, processor } = harness([claimed()], {
      send: async () => ({ outcome: 'failed', statusCode: 500, errorMessage: 'HTTP 500' }),
    });

    await processor.processNext();

    expect(recorded[0]).toMatchObject({ outcome: 'failed', statusCode: 500 });
    expect(completed).toEqual(['outbox-1']);
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
