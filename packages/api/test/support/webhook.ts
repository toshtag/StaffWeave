import type { Database } from '@staffweave/db';
import type { WebhookDeliveryProcessor } from '../../src/integration/delivery-processor.js';
import { createWebhookDeliveryProcessor } from '../../src/integration/delivery-processor.js';
import { createWebhookOutboxRepository } from '../../src/integration/outbox-repository.js';
import { createIntegrationRepository } from '../../src/integration/repository.js';
import type { WebhookTransport } from '../../src/integration/sender.js';
import { createWebhookSender } from '../../src/integration/sender.js';

/**
 * 統合テストから Webhook の送信ワーカーを 1 回分だけ動かすための組み立て。
 *
 * API は送信待ちを記録するだけなので、送信の結果を確かめるテストはこれを使う。
 */

export interface SentWebhook {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 送信内容を控えたうえで、指定した応答を返す通信。 */
export function recordingTransport(
  sent: SentWebhook[],
  respond: (request: SentWebhook) => Response | Promise<Response> = () =>
    new Response(null, { status: 204 }),
): WebhookTransport {
  return async (url, headers, body) => {
    const request = { url, headers, body };
    sent.push(request);
    return respond(request);
  };
}

export interface TestDeliveryOptions {
  now: Date;
  transport: WebhookTransport;
  batchSize?: number;
  claimLeaseMs?: number;
  sendTimeoutMs?: number;
}

export function createTestDeliveryProcessor(
  db: Database,
  options: TestDeliveryOptions,
): WebhookDeliveryProcessor {
  return createWebhookDeliveryProcessor({
    outbox: createWebhookOutboxRepository(db),
    deliveries: createIntegrationRepository(db),
    send: createWebhookSender({
      transport: options.transport,
      timeoutMs: options.sendTimeoutMs ?? 1_000,
    }),
    now: () => options.now,
    batchSize: options.batchSize ?? 20,
    claimLeaseMs: options.claimLeaseMs ?? 60_000,
  });
}
