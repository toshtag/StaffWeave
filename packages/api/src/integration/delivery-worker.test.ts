import { describe, expect, it } from 'vitest';
import { createWebhookDeliveryWorker } from './delivery-worker.js';

describe('createWebhookDeliveryWorker', () => {
  it('送信待ちが続く間は間隔をあけずに処理する', async () => {
    let remaining = 3;
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 60_000,
      processor: {
        processBatch: async () => {
          if (remaining === 0) {
            worker.stop();
            return 0;
          }
          remaining -= 1;
          return 1;
        },
      },
    });

    // 待機に入るのは処理する行が無くなった後だけ。間隔が長くても待たずに終わる。
    await worker.run();
    expect(remaining).toBe(0);
  });

  it('停止を要求すると待機を打ち切って終わる', async () => {
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 60_000,
      processor: { processBatch: async () => 0 },
    });

    const running = worker.run();
    // 待機へ入ったところで止める。
    await new Promise((resolve) => setImmediate(resolve));
    worker.stop();

    await expect(running).resolves.toBeUndefined();
  });

  it('処理が例外を投げてもループを止めない', async () => {
    let attempts = 0;
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 1,
      processor: {
        processBatch: async () => {
          attempts += 1;
          if (attempts >= 3) {
            worker.stop();
            return 0;
          }
          throw new Error('データベースへ接続できません');
        },
      },
    });

    await worker.run();
    expect(attempts).toBe(3);
  });
});
