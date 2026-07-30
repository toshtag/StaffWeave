/**
 * Webhook 送信ワーカー。
 *
 *   pnpm --filter "@staffweave/api" webhook-worker
 *
 * API サーバーは送信待ちを記録するだけで、HTTP 送信は行わない。
 * このプロセスを動かさない限り、Webhook は届かない。
 */

import { createDatabase } from '@staffweave/db';
import { loadConfig } from '../config.js';
import { createWebhookDeliveryProcessor } from '../integration/delivery-processor.js';
import { createWebhookDeliveryWorker } from '../integration/delivery-worker.js';
import { createWebhookOutboxRepository } from '../integration/outbox-repository.js';
import { createIntegrationRepository } from '../integration/repository.js';
import { createWebhookSender } from '../integration/sender.js';
import { createConsoleLogger } from '../shared/logger.js';

const config = loadConfig();
const logger = createConsoleLogger('webhook-worker');
const db = createDatabase({ connectionString: config.databaseUrl });

const worker = createWebhookDeliveryWorker({
  processor: createWebhookDeliveryProcessor({
    outbox: createWebhookOutboxRepository(db),
    deliveries: createIntegrationRepository(db),
    send: createWebhookSender({ timeoutMs: config.webhookWorker.sendTimeoutMs }),
    now: () => new Date(),
    batchSize: config.webhookWorker.batchSize,
    claimLeaseMs: config.webhookWorker.claimLeaseMs,
    logger,
  }),
  pollIntervalMs: config.webhookWorker.pollIntervalMs,
  logger,
});

// 新しい取り出しを止め、処理中の送信が終わってから接続を閉じる。
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('worker.stopping', { signal });
    worker.stop();
  });
}

await worker.run();
await db.close();
