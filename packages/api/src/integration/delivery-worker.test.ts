import { describe, expect, it } from 'vitest';
import { createWebhookDeliveryWorker } from './delivery-worker.js';

describe('createWebhookDeliveryWorker', () => {
  it('送信待ちが続く間は間隔をあけずに次の 1 件へ進む', async () => {
    let remaining = 3;
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 60_000,
      processor: {
        processNext: async () => {
          if (remaining === 0) {
            worker.stop();
            return false;
          }
          remaining -= 1;
          return true;
        },
      },
    });

    // 待機に入るのは処理する行が無くなった後だけ。間隔が長くても待たずに終わる。
    await worker.run();
    expect(remaining).toBe(0);
  });

  it('停止を要求したら次の 1 件を取りに行かない', async () => {
    let processed = 0;
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 60_000,
      processor: {
        processNext: async () => {
          processed += 1;
          // 送信中に停止を受け取った状況にあたる。
          worker.stop();
          return true;
        },
      },
    });

    await worker.run();
    expect(processed).toBe(1);
  });

  it('停止を要求すると待機を打ち切って終わる', async () => {
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 60_000,
      processor: { processNext: async () => false },
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
        processNext: async () => {
          attempts += 1;
          if (attempts >= 3) {
            worker.stop();
            return false;
          }
          throw new Error('データベースへ接続できません');
        },
      },
    });

    await worker.run();
    expect(attempts).toBe(3);
  });
});
