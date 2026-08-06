import type { Database } from '@staffweave/db';
import type { RetryPolicy } from '@staffweave/domain';
import type { WebhookDeliveryProcessor } from '../../src/integration/delivery-processor.js';
import { createWebhookDeliveryProcessor } from '../../src/integration/delivery-processor.js';
import { createWebhookOutboxRepository } from '../../src/integration/outbox-repository.js';
import { createIntegrationRepository } from '../../src/integration/repository.js';
import { createWebhookSender } from '../../src/integration/sender.js';
import type { WebhookTransport } from '../../src/integration/webhook-http-transport.js';
import type {
  WebhookHostResolver,
  WebhookNetworkPolicyMode,
  WebhookTargetValidator,
} from '../../src/integration/webhook-network-policy.js';
import {
  createWebhookNetworkPolicy,
  createWebhookTargetValidator,
} from '../../src/integration/webhook-network-policy.js';

/**
 * 統合テストから Webhook の送信ワーカーを 1 回分だけ動かすための組み立て。
 *
 * API は送信待ちを記録するだけなので、送信の結果を確かめるテストはこれを使う。
 * 名前解決は必ず偽の解決器へ差し替える。テストを外部の DNS に依存させない。
 */

/** 公開ネットワークとして扱えるアドレス。テストの送信先はすべてここへ解決させる。 */
export const PUBLIC_TEST_ADDRESS = '93.184.216.34';

/** どのホスト名でも同じアドレスを返す解決器。 */
export function fixedResolver(address = PUBLIC_TEST_ADDRESS): WebhookHostResolver {
  const family = address.includes(':') ? (6 as const) : (4 as const);
  return async () => [{ address, family }];
}

/** 登録時の検査。外部 DNS を引かずに、実際のポリシー判定だけを通す。 */
export function testWebhookTargetValidator(
  resolver: WebhookHostResolver = fixedResolver(),
  mode: WebhookNetworkPolicyMode = 'public-only',
  timeoutMs = 1_000,
): WebhookTargetValidator {
  return createWebhookTargetValidator(createWebhookNetworkPolicy({ mode, resolver }), {
    timeoutMs,
  });
}

export interface SentWebhook {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 送信内容を控えたうえで、指定した応答を返す通信。 */
export function recordingTransport(
  sent: SentWebhook[],
  respond: (request: SentWebhook) => number | Promise<number> = () => 204,
): WebhookTransport {
  return async (target, headers, body) => {
    const request = { url: target.url.href, headers, body };
    sent.push(request);
    return { statusCode: await respond(request), bodyLimitExceeded: false };
  };
}

export interface TestDeliveryOptions {
  now: Date;
  transport: WebhookTransport;
  claimLeaseMs?: number;
  sendTimeoutMs?: number;
  resolver?: WebhookHostResolver;
  /** 再試行の方針。省略すると既定値。 */
  retryPolicy?: RetryPolicy;
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
      resolver: options.resolver ?? fixedResolver(),
      networkPolicy: 'public-only',
      timeoutMs: options.sendTimeoutMs ?? 1_000,
    }),
    now: () => options.now,
    claimLeaseMs: options.claimLeaseMs ?? 60_000,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    // 間隔をずらす値は固定にする。検査のたびに待ち時間が変わらないようにする。
    jitter: () => 0,
  });
}

/** 送信待ちが無くなるまで 1 件ずつ処理する。 */
export async function drain(processor: WebhookDeliveryProcessor): Promise<number> {
  let processed = 0;
  while (await processor.processNext()) processed += 1;
  return processed;
}
