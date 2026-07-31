import { randomBytes } from 'node:crypto';
import type { NotificationOutbox } from '../shared/notification-outbox.js';
import type { WebhookOutboxRepository } from './outbox-repository.js';
import type { IntegrationRepository } from './repository.js';

/**
 * 出来事を Webhook の送信待ちへ積む実装。
 *
 * 業務処理と同じトランザクションから呼ばれるため、
 * 渡す Repository も同じトランザクションのものにする。
 */

export interface WebhookOutboxWriterDependencies {
  endpoints: Pick<IntegrationRepository, 'listActiveEndpointIdsFor'>;
  outbox: WebhookOutboxRepository;
  /** 出来事の識別子。再処理しても変わらないよう、積むときに一度だけ決める。 */
  newEventId?: () => string;
}

export function createWebhookOutboxWriter(
  deps: WebhookOutboxWriterDependencies,
): NotificationOutbox {
  const newEventId = deps.newEventId ?? (() => randomBytes(12).toString('hex'));

  return {
    async enqueue(workspaceId, event) {
      // 積むのに要るのは送信先の識別子だけ。URL と署名鍵は送信の直前にワーカーが読む。
      const endpointIds = await deps.endpoints.listActiveEndpointIdsFor(
        workspaceId,
        event.eventType,
      );
      if (endpointIds.length === 0) return;

      // 送信先が複数あっても出来事は 1 つ。同じ識別子を配って重複排除の単位をそろえる。
      const eventId = newEventId();
      for (const endpointId of endpointIds) {
        await deps.outbox.enqueue(workspaceId, {
          endpointId,
          eventType: event.eventType,
          eventId,
          payload: event.payload,
          occurredAt: event.occurredAt,
        });
      }
    },
  };
}
