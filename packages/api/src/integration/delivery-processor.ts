import { createHmac } from 'node:crypto';
import { canonicalWebhookMessage } from '@staffweave/domain';
import type { StructuredLogger } from '../shared/logger.js';
import { silentLogger } from '../shared/logger.js';
import type { ClaimedWebhookDelivery, WebhookOutboxRepository } from './outbox-repository.js';
import type { IntegrationRepository, WebhookDeliveryRecord } from './repository.js';
import type { WebhookSender } from './sender.js';

/**
 * 送信待ちを取り出して送る処理。
 *
 * 1 件分の処理を関数として切り出し、常駐ループとは別にテストできるようにする。
 * 取り出しは送信の直前に 1 件だけ行う。先に何件もまとめて取ると、まだ送っていない行の
 * 占有期限が切れ、別のワーカーが引き取って同時に送ってしまう。
 *
 * HTTP の失敗やタイムアウトは自動で再試行しない。結果を記録して送信待ちを完了扱いにする。
 * 再試行と指数バックオフは P20 で扱う。
 */

export interface WebhookDeliveryProcessor {
  /** 送信待ちを 1 件だけ処理する。処理する行があれば true を返す。 */
  processNext(): Promise<boolean>;
}

export interface WebhookDeliveryProcessorDependencies {
  outbox: WebhookOutboxRepository;
  deliveries: Pick<IntegrationRepository, 'recordDelivery'>;
  send: WebhookSender;
  now: () => Date;
  claimLeaseMs: number;
  logger?: StructuredLogger;
}

const SKIPPED: {
  outcome: WebhookDeliveryRecord['outcome'];
  statusCode: number | null;
  errorMessage: string;
} = {
  outcome: 'skipped',
  statusCode: null,
  errorMessage: '送信先が停止しているため送信しませんでした',
};

function signatureOf(
  secretHash: string,
  message: { eventId: string; eventType: string; timestamp: string; body: string },
): string {
  // 署名にはハッシュではなく秘密そのものが必要だが、サーバーはハッシュしか持たない。
  // ハッシュを鍵として使うことで、保存物が漏れても受け取り側の検証鍵は別に保てる。
  return createHmac('sha256', secretHash)
    .update(canonicalWebhookMessage(message), 'utf8')
    .digest('base64');
}

export function createWebhookDeliveryProcessor(
  deps: WebhookDeliveryProcessorDependencies,
): WebhookDeliveryProcessor {
  const logger = deps.logger ?? silentLogger;

  const deliver = async (entry: ClaimedWebhookDelivery): Promise<void> => {
    const attemptedAt = deps.now();
    const timestamp = attemptedAt.toISOString();
    // 署名の時刻は送信を試みた時刻。受け取り側が古い通知に気付けるようにする。
    // 出来事が起きた時刻は本文の occurredAt で伝える。
    const body = JSON.stringify({
      eventId: entry.eventId,
      eventType: entry.eventType,
      occurredAt: entry.occurredAt,
      data: entry.payload,
    });

    const result =
      entry.endpoint === null
        ? SKIPPED
        : await deps.send({
            url: entry.endpoint.url,
            headers: {
              'content-type': 'application/json',
              'x-staffweave-event': entry.eventType,
              'x-staffweave-event-id': entry.eventId,
              'x-staffweave-timestamp': timestamp,
              'x-staffweave-signature': signatureOf(entry.endpoint.secretHash, {
                eventId: entry.eventId,
                eventType: entry.eventType,
                timestamp,
                body,
              }),
            },
            body,
          });

    await deps.deliveries.recordDelivery(entry.workspaceId, {
      endpointId: entry.endpointId,
      eventType: entry.eventType,
      eventId: entry.eventId,
      payload: entry.payload,
      attemptedAt,
      statusCode: result.statusCode,
      outcome: result.outcome,
      errorMessage: result.errorMessage,
    });

    const completed = await deps.outbox.complete(entry.id, entry.claimToken, deps.now());
    if (!completed) {
      // 送信が占有期限を超え、別のワーカーが引き取った後だと起こり得る。
      logger.error('outbox.complete_rejected', { outboxId: entry.id, eventId: entry.eventId });
      return;
    }

    logger.info('webhook.delivered', {
      outboxId: entry.id,
      eventId: entry.eventId,
      eventType: entry.eventType,
      outcome: result.outcome,
      statusCode: result.statusCode,
    });
  };

  return {
    async processNext() {
      const entry = await deps.outbox.claimNext({
        now: deps.now(),
        leaseMs: deps.claimLeaseMs,
      });
      if (entry === null) return false;

      // 1 件の失敗でループを止めない。処理できなかった行は取得の期限切れ後に拾い直す。
      try {
        await deliver(entry);
      } catch (error) {
        logger.error('webhook.delivery_failed', {
          outboxId: entry.id,
          eventId: entry.eventId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      return true;
    },
  };
}
