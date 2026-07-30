import type { StructuredLogger } from '../shared/logger.js';
import { silentLogger } from '../shared/logger.js';
import type { WebhookDeliveryProcessor } from './delivery-processor.js';

/**
 * Webhook 送信の常駐ループ。
 *
 * 1 回分の処理は processor が持ち、ここは繰り返しと停止だけを担う。
 * 送信待ちが無ければ間隔をあけて確かめ直す。
 */

export interface WebhookDeliveryWorker {
  run(): Promise<void>;
  /** 新しい取得を止める。処理中の送信は終わるまで待つ。 */
  stop(): void;
}

export interface WebhookDeliveryWorkerDependencies {
  processor: WebhookDeliveryProcessor;
  pollIntervalMs: number;
  logger?: StructuredLogger;
}

export function createWebhookDeliveryWorker(
  deps: WebhookDeliveryWorkerDependencies,
): WebhookDeliveryWorker {
  const logger = deps.logger ?? silentLogger;
  let running = false;
  let wake: (() => void) | null = null;

  // 停止の要求をすぐ受け取れるよう、待機は途中で打ち切れるようにする。
  const idle = (): Promise<void> =>
    new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
      timer = setTimeout(finish, deps.pollIntervalMs);
      wake = finish;
    });

  return {
    async run() {
      running = true;
      logger.info('worker.started', { pollIntervalMs: deps.pollIntervalMs });

      while (running) {
        let processed = 0;
        try {
          processed = await deps.processor.processBatch();
        } catch (error) {
          // データベースへ届かない場合など。間隔をあけて次の周回で試し直す。
          logger.error('worker.batch_failed', {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        if (!running) break;
        if (processed === 0) await idle();
      }

      logger.info('worker.stopped');
    },

    stop() {
      running = false;
      wake?.();
    },
  };
}
