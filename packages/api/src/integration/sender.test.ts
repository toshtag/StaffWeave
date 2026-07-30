import { describe, expect, it } from 'vitest';
import { createWebhookSender } from './sender.js';

const request = { url: 'https://example.test/hooks', headers: {}, body: '{}' };

describe('createWebhookSender', () => {
  it('2xx の応答を成功として返す', async () => {
    const send = createWebhookSender({
      timeoutMs: 1_000,
      transport: async () => new Response(null, { status: 204 }),
    });

    expect(await send(request)).toEqual({
      outcome: 'delivered',
      statusCode: 204,
      errorMessage: null,
    });
  });

  it('2xx 以外の応答を失敗として返す', async () => {
    const send = createWebhookSender({
      timeoutMs: 1_000,
      transport: async () => new Response(null, { status: 500 }),
    });

    expect(await send(request)).toEqual({
      outcome: 'failed',
      statusCode: 500,
      errorMessage: 'HTTP 500',
    });
  });

  it('通信の例外を失敗として返す', async () => {
    const send = createWebhookSender({
      timeoutMs: 1_000,
      transport: async () => {
        throw new Error('名前を解決できません');
      },
    });

    expect(await send(request)).toEqual({
      outcome: 'failed',
      statusCode: null,
      errorMessage: '名前を解決できません',
    });
  });

  it('応答しない送信先は上限時間で打ち切る', async () => {
    const send = createWebhookSender({
      timeoutMs: 20,
      transport: () => new Promise<Response>(() => {}),
    });

    const result = await send(request);
    expect(result.outcome).toBe('failed');
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain('20 ミリ秒');
  });

  it('打ち切るときに中断を通知する', async () => {
    let aborted = false;
    const send = createWebhookSender({
      timeoutMs: 20,
      transport: (_url, _headers, _body, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('中断しました'));
          });
        }),
    });

    await send(request);
    expect(aborted).toBe(true);
  });
});
