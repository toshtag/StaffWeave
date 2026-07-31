import { describe, expect, it } from 'vitest';
import type { WebhookSenderDependencies } from './sender.js';
import { createWebhookSender } from './sender.js';
import type { WebhookResponseSummary } from './webhook-http-transport.js';
import type { WebhookHostResolver } from './webhook-network-policy.js';

const request = { url: 'https://example.test/hooks', headers: {}, body: '{}' };

/** 名前解決を外部 DNS へ依存させない。既定では公開扱いのアドレスを返す。 */
const publicResolver: WebhookHostResolver = async () => [{ address: '93.184.216.34', family: 4 }];

const responded = (statusCode: number): WebhookResponseSummary => ({
  statusCode,
  bodyLimitExceeded: false,
});

function sender(overrides: Partial<WebhookSenderDependencies>) {
  return createWebhookSender({
    networkPolicy: 'public-only',
    timeoutMs: 1_000,
    resolver: publicResolver,
    ...overrides,
  });
}

describe('createWebhookSender', () => {
  it('2xx の応答を成功として返す', async () => {
    const send = sender({ transport: async () => responded(204) });

    expect(await send(request)).toEqual({
      outcome: 'delivered',
      statusCode: 204,
      errorMessage: null,
    });
  });

  it('2xx 以外の応答を失敗として返す', async () => {
    const send = sender({ transport: async () => responded(500) });

    expect(await send(request)).toEqual({
      outcome: 'failed',
      statusCode: 500,
      errorMessage: 'HTTP 500',
    });
  });

  it('通信の例外を失敗として返す', async () => {
    const send = sender({
      transport: async () => {
        throw new Error('接続できません');
      },
    });

    expect(await send(request)).toEqual({
      outcome: 'failed',
      statusCode: null,
      errorMessage: '接続できません',
    });
  });

  it('応答しない送信先は上限時間で打ち切る', async () => {
    const send = sender({
      timeoutMs: 20,
      transport: () => new Promise<WebhookResponseSummary>(() => {}),
    });

    const result = await send(request);
    expect(result.outcome).toBe('failed');
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain('20 ミリ秒');
  });

  it('打ち切るときに中断を通知する', async () => {
    let aborted = false;
    const send = sender({
      timeoutMs: 20,
      transport: (_target, _headers, _body, signal) =>
        new Promise<WebhookResponseSummary>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('中断しました'));
          });
        }),
    });

    await send(request);
    expect(aborted).toBe(true);
  });

  describe('リダイレクト', () => {
    it('3xx を失敗として返し、転送先へは送らない', async () => {
      let calls = 0;
      const send = sender({
        transport: async () => {
          calls += 1;
          return responded(302);
        },
      });

      expect(await send(request)).toEqual({
        outcome: 'failed',
        statusCode: 302,
        errorMessage: 'HTTP 302（リダイレクトには追従しません）',
      });
      expect(calls).toBe(1);
    });
  });

  describe('送信直前の検査', () => {
    it('名前解決が内部アドレスへ変わっていれば通信しない', async () => {
      let called = false;
      const send = sender({
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        transport: async () => {
          called = true;
          return responded(204);
        },
      });

      const result = await send(request);
      expect(called).toBe(false);
      expect(result.outcome).toBe('failed');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toContain('許可されていないアドレス');
    });

    it('登録済みの内部 URL でも送信時に拒む', async () => {
      let called = false;
      const send = sender({
        transport: async () => {
          called = true;
          return responded(204);
        },
      });

      const result = await send({ ...request, url: 'http://169.254.169.254/latest/meta-data/' });
      expect(called).toBe(false);
      expect(result.outcome).toBe('failed');
      expect(result.errorMessage).toContain('許可されていないネットワーク');
    });

    it('名前解決が上限時間を過ぎてから終わっても通信を始めない', async () => {
      let called = false;
      const send = sender({
        timeoutMs: 20,
        resolver: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 60);
          }),
        transport: async () => {
          called = true;
          return responded(204);
        },
      });

      const result = await send(request);
      expect(result.errorMessage).toContain('20 ミリ秒');

      // 打ち切った後に名前解決が終わっても、新しい接続は開かない。
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(called).toBe(false);
    });

    it('送信の中断信号を解決器へ渡す', async () => {
      let aborted = false;
      const send = sender({
        timeoutMs: 20,
        resolver: (_hostname, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('中断しました'));
            });
          }),
        transport: async () => responded(204),
      });

      await send(request);
      expect(aborted).toBe(true);
    });

    it('名前解決の失敗を利用者向けの文言へ変える', async () => {
      const send = sender({
        resolver: async () => {
          throw new Error('getaddrinfo ENOTFOUND example.test');
        },
        transport: async () => responded(204),
      });

      const result = await send(request);
      expect(result.errorMessage).toBe('Webhook 送信先の名前を解決できません');
    });
  });

  describe('応答本文の上限', () => {
    it('上限までの本文は成否の判定に影響しない', async () => {
      const send = sender({
        transport: async () => ({ statusCode: 200, bodyLimitExceeded: false }),
      });

      expect((await send(request)).outcome).toBe('delivered');
    });

    it('上限を超えた応答を失敗として記録する', async () => {
      const send = sender({
        transport: async () => ({ statusCode: 200, bodyLimitExceeded: true }),
      });

      const result = await send(request);
      expect(result).toEqual({
        outcome: 'failed',
        statusCode: 200,
        errorMessage: 'Webhook 応答本文が 65536 バイトの上限を超えました',
      });
    });
  });
});
