import type { WebhookEventType } from '@staffweave/domain';

/**
 * 業務処理から外部への通知を切り離すための境界。
 *
 * 承認や締めは、通知の実装（送信先の検索、署名、HTTP 通信）を知らない。
 * 知っているのは「この出来事を送信待ちへ積む」ことだけで、
 * 積む操作は業務処理と同じトランザクションで確定する。
 *
 * これにより、コミットされなかった処理が外部へ伝わることも、
 * 応答しない送信先が業務処理を待たせることもなくなる。
 */

export interface NotificationEvent {
  eventType: WebhookEventType;
  payload: unknown;
  /** 出来事が起きた時刻。実際に送信を試みる時刻とは別。 */
  occurredAt: Date;
}

export interface NotificationOutbox {
  enqueue(workspaceId: string, event: NotificationEvent): Promise<void>;
}
