import { describe, expect, it } from 'vitest';
import type { WebhookOutboxEntry, WebhookOutboxRepository } from './outbox-repository.js';
import { createWebhookOutboxWriter } from './outbox-writer.js';

const OCCURRED_AT = new Date('2026-04-01T09:00:00.000Z');

interface Endpoint {
  id: string;
  url: string;
  secretHash: string;
  eventTypes: string[];
}

function writerOver(endpoints: Endpoint[]): {
  enqueued: (WebhookOutboxEntry & { workspaceId: string })[];
  writer: ReturnType<typeof createWebhookOutboxWriter>;
} {
  const enqueued: (WebhookOutboxEntry & { workspaceId: string })[] = [];
  const outbox: WebhookOutboxRepository = {
    enqueue: async (workspaceId, entry) => {
      enqueued.push({ ...entry, workspaceId });
    },
    claimPending: async () => [],
    complete: async () => true,
  };

  let counter = 0;
  const writer = createWebhookOutboxWriter({
    endpoints: {
      listActiveEndpointsFor: async (_workspaceId, eventType) =>
        endpoints
          .filter((endpoint) => endpoint.eventTypes.includes(eventType))
          .map(({ id, url, secretHash }) => ({ id, url, secretHash })),
    },
    outbox,
    newEventId: () => `event-${++counter}`,
  });

  return { enqueued, writer };
}

const endpoint = (id: string, eventTypes: string[]): Endpoint => ({
  id,
  url: `https://example.test/${id}`,
  secretHash: `hash-${id}`,
  eventTypes,
});

describe('createWebhookOutboxWriter', () => {
  it('出来事の種別に一致する送信先だけを積む', async () => {
    const { enqueued, writer } = writerOver([
      endpoint('a', ['attendance_request.approved']),
      endpoint('b', ['monthly_closing.closed']),
    ]);

    await writer.enqueue('workspace-1', {
      eventType: 'attendance_request.approved',
      payload: { requestId: 'r1' },
      occurredAt: OCCURRED_AT,
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.endpointId).toBe('a');
    expect(enqueued[0]?.workspaceId).toBe('workspace-1');
    expect(enqueued[0]?.occurredAt).toEqual(OCCURRED_AT);
  });

  it('送信先が無ければ何も積まない', async () => {
    const { enqueued, writer } = writerOver([endpoint('a', ['monthly_closing.closed'])]);

    await writer.enqueue('workspace-1', {
      eventType: 'attendance_request.approved',
      payload: {},
      occurredAt: OCCURRED_AT,
    });

    expect(enqueued).toEqual([]);
  });

  it('同じ出来事の送信先には同じ識別子を配る', async () => {
    const { enqueued, writer } = writerOver([
      endpoint('a', ['monthly_closing.closed']),
      endpoint('b', ['monthly_closing.closed']),
    ]);

    await writer.enqueue('workspace-1', {
      eventType: 'monthly_closing.closed',
      payload: { period: '2026-04-01' },
      occurredAt: OCCURRED_AT,
    });
    await writer.enqueue('workspace-1', {
      eventType: 'monthly_closing.closed',
      payload: { period: '2026-05-01' },
      occurredAt: OCCURRED_AT,
    });

    expect(enqueued.map((entry) => entry.eventId)).toEqual([
      'event-1',
      'event-1',
      'event-2',
      'event-2',
    ]);
  });
});
