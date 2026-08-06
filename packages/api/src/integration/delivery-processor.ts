import type { RetryPolicy } from '@staffweave/domain';
import { DEFAULT_RETRY_POLICY, isRetryable, retryDelayMs, shouldAbandon } from '@staffweave/domain';
import type { StructuredLogger } from '../shared/logger.js';
import { silentLogger } from '../shared/logger.js';
import type { ClaimedWebhookDelivery, WebhookOutboxRepository } from './outbox-repository.js';
import type { IntegrationRepository, WebhookDeliveryRecord } from './repository.js';
import type { WebhookSender } from './sender.js';
import { signWebhookMessage } from './webhook-signature.js';

/**
 * 送信待ちを取り出して送る処理。
 *
 * 1 件分の処理を関数として切り出し、常駐ループとは別にテストできるようにする。
 * 取り出しは送信の直前に 1 件だけ行う。先に何件もまとめて取ると、まだ送っていない行の
 * 占有期限が切れ、別のワーカーが引き取って同時に送ってしまう。
 *
 * 送れなかったものは間を空けて送り直す。間隔は試行のたびに広げる。
 * 広げないと、止まっている相手へ送り続けて復旧を妨げる。
 *
 * 相手が「その要求は受け取れない」と言っているものは送り直さない。
 * 同じ要求を送り直しても、同じ答えしか返らない。
 *
 * 決めた回数を超えたら諦め、行は残したまま印を付ける。
 * 消すと、届かなかったこと自体が分からなくなる。諦めた行は人が手で送り直せる。
 */

export interface WebhookDeliveryProcessor {
  /** 送信待ちを 1 件だけ処理する。処理する行があれば true を返す。 */
  processNext(): Promise<boolean>;
}

export interface WebhookDeliveryProcessorDependencies {
  outbox: WebhookOutboxRepository;
  deliveries: Pick<IntegrationRepository, 'recordDelivery'>;
  send: WebhookSender;
  /**
   * 送信を試みた時刻。署名の timestamp と送信履歴に使う。
   * ワーカー同士の排他には使わない。そちらは PostgreSQL の時刻で決める。
   */
  now: () => Date;
  claimLeaseMs: number;
  logger?: StructuredLogger;
  /** 再試行の方針。省略すると既定値。 */
  retryPolicy?: RetryPolicy;
  /**
   * 間隔をずらすための 0 以上 1 未満の値。
   * 既定は乱数。検査では固定値を渡し、同じ入力で同じ答えを返させる。
   */
  jitter?: () => number;
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

export function createWebhookDeliveryProcessor(
  deps: WebhookDeliveryProcessorDependencies,
): WebhookDeliveryProcessor {
  const logger = deps.logger ?? silentLogger;
  const policy = deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const jitter = deps.jitter ?? Math.random;

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
              // 署名鍵は署名を生成できる機密情報。データベースを読める者は正当な署名を
              // 作れるため、通常の秘密鍵と同じ扱いにする。ログにも残さない。
              'x-staffweave-signature': signWebhookMessage(entry.endpoint.signingKey, {
                eventId: entry.eventId,
                eventType: entry.eventType,
                timestamp,
                body,
              }),
            },
            body,
          });

    const attempt = entry.attempts + 1;
    await deps.deliveries.recordDelivery(entry.workspaceId, {
      endpointId: entry.endpointId,
      eventType: entry.eventType,
      eventId: entry.eventId,
      payload: entry.payload,
      attemptedAt,
      statusCode: result.statusCode,
      outcome: result.outcome,
      errorMessage: result.errorMessage,
      attempt,
    });

    // 送り直しても同じ答えしか返らないものは、ここで打ち切る。
    // 送信先が止まっているだけの場合も同じで、再開したときに次の出来事から送る。
    const retryable = result.outcome === 'failed' && isRetryable(result.statusCode);

    if (retryable && !shouldAbandon(policy, attempt)) {
      const delayMs = retryDelayMs(policy, attempt, jitter());
      const scheduled = await deps.outbox.scheduleRetry(entry.id, entry.claimToken, {
        delayMs,
        lastError: result.errorMessage ?? '',
      });
      if (!scheduled) {
        logger.error('outbox.retry_rejected', { outboxId: entry.id, eventId: entry.eventId });
        return;
      }
      logger.info('webhook.delivery_retry_scheduled', {
        outboxId: entry.id,
        eventId: entry.eventId,
        eventType: entry.eventType,
        attempt,
        delayMs,
        statusCode: result.statusCode,
      });
      return;
    }

    if (retryable) {
      const abandoned = await deps.outbox.abandon(
        entry.id,
        entry.claimToken,
        result.errorMessage ?? '',
      );
      if (!abandoned) {
        logger.error('outbox.abandon_rejected', { outboxId: entry.id, eventId: entry.eventId });
        return;
      }
      // 諦めたことは、運用が気付ける高さで残す。行は消していない。
      logger.error('webhook.delivery_abandoned', {
        outboxId: entry.id,
        eventId: entry.eventId,
        eventType: entry.eventType,
        attempts: attempt,
        statusCode: result.statusCode,
      });
      return;
    }

    const completed = await deps.outbox.complete(entry.id, entry.claimToken);
    if (!completed) {
      // 送信が占有期限を超え、別のワーカーが引き取った後だと起こり得る。
      logger.error('outbox.complete_rejected', { outboxId: entry.id, eventId: entry.eventId });
      return;
    }

    // 送信の成否は outcome で表す。イベント名からは成功と読み取れないようにする。
    logger.info('webhook.delivery_completed', {
      outboxId: entry.id,
      eventId: entry.eventId,
      eventType: entry.eventType,
      outcome: result.outcome,
      statusCode: result.statusCode,
      attempt,
    });
  };

  return {
    async processNext() {
      const entry = await deps.outbox.claimNext({ leaseMs: deps.claimLeaseMs });
      if (entry === null) return false;

      // 1 件の失敗でループを止めない。処理できなかった行は取得の期限切れ後に拾い直す。
      // HTTP の失敗とは別物なので、イベント名も分ける。
      try {
        await deliver(entry);
      } catch (error) {
        logger.error('webhook.delivery_processing_failed', {
          outboxId: entry.id,
          eventId: entry.eventId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      return true;
    },
  };
}
