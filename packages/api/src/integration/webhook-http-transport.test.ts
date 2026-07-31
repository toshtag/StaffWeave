import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRequestOptions,
  nodeWebhookTransport,
  WEBHOOK_MAX_RESPONSE_BODY_BYTES,
  WEBHOOK_MAX_RESPONSE_HEADER_BYTES,
} from './webhook-http-transport.js';
import type { ResolvedWebhookTarget } from './webhook-network-policy.js';

const target = (url: string, address = '127.0.0.1'): ResolvedWebhookTarget => ({
  url: new URL(url),
  address,
  family: address.includes(':') ? 6 : 4,
});

describe('buildRequestOptions', () => {
  it('検査済みのアドレスだけを返す名前解決を渡す', async () => {
    const options = buildRequestOptions(target('https://example.test/hook', '93.184.216.34'), {});
    const resolved = await new Promise<{ address: string; family: number }>((resolve) => {
      options.lookup?.('example.test', {}, (_error, address, family) => {
        resolve({ address: String(address), family: Number(family) });
      });
    });

    expect(resolved).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('接続先を固定しても TLS は元のホスト名で検証する', () => {
    const options = buildRequestOptions(target('https://example.test/hook', '93.184.216.34'), {});
    expect(options.servername).toBe('example.test');
    // 証明書の検証は既定のまま。接続を通すために緩めない。
    expect(options.rejectUnauthorized).toBeUndefined();
  });

  it('送信先が IP リテラルなら SNI を付けない', () => {
    const options = buildRequestOptions(target('https://93.184.216.34/hook', '93.184.216.34'), {});
    expect(options.servername).toBeUndefined();
  });

  it('Host には元の URL の authority を使う', () => {
    expect(buildRequestOptions(target('https://example.test/hook'), {}).headers.host).toBe(
      'example.test',
    );
    expect(buildRequestOptions(target('http://example.test:8080/hook'), {}).headers.host).toBe(
      'example.test:8080',
    );
  });

  it('IPv6 リテラルの角括弧を外して接続する', () => {
    const options = buildRequestOptions(target('http://[::1]:8080/hook', '::1'), {});
    expect(options.hostname).toBe('::1');
    expect(options.headers.host).toBe('[::1]:8080');
  });

  it('経路と問い合わせ文字列をそのまま送る', () => {
    expect(buildRequestOptions(target('https://example.test/hook?a=1'), {}).path).toBe('/hook?a=1');
  });

  it('応答ヘッダーの上限と接続の使い捨てを指定する', () => {
    const options = buildRequestOptions(target('https://example.test/hook'), {});
    expect(options.maxHeaderSize).toBe(WEBHOOK_MAX_RESPONSE_HEADER_BYTES);
    expect(options.agent).toBe(false);
  });
});

describe('nodeWebhookTransport', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((r) => server.close(r))));
  });

  async function listen(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ): Promise<number> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  const send = (url: string, address = '127.0.0.1') =>
    nodeWebhookTransport(target(url, address), {}, '{}', new AbortController().signal);

  it('応答の状態番号を返す', async () => {
    const port = await listen((_request, response) => response.writeHead(204).end());
    expect(await send(`http://127.0.0.1:${port}/hook`)).toEqual({
      statusCode: 204,
      bodyLimitExceeded: false,
    });
  });

  it('検査済みのアドレスへ接続する', async () => {
    let seenHost: string | undefined;
    const port = await listen((request, response) => {
      seenHost = request.headers.host;
      response.writeHead(204).end();
    });

    // ホスト名は解決させず、検査済みの 127.0.0.1 へつなぐ。
    const result = await send(`http://example.test:${port}/hook`);
    expect(result.statusCode).toBe(204);
    expect(seenHost).toBe(`example.test:${port}`);
  });

  it('リダイレクトを追わず、転送先へは到達しない', async () => {
    let reachedInternal = 0;
    const internalPort = await listen((_request, response) => {
      reachedInternal += 1;
      response.writeHead(200).end('internal');
    });

    let reachedEntry = 0;
    const entryPort = await listen((_request, response) => {
      reachedEntry += 1;
      response.writeHead(302, { location: `http://127.0.0.1:${internalPort}/internal` }).end();
    });

    expect(await send(`http://127.0.0.1:${entryPort}/hook`)).toEqual({
      statusCode: 302,
      bodyLimitExceeded: false,
    });
    expect(reachedEntry).toBe(1);
    expect(reachedInternal).toBe(0);
  });

  it('上限までの応答本文は読み切る', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200).end(Buffer.alloc(WEBHOOK_MAX_RESPONSE_BODY_BYTES, 0x61));
    });

    expect(await send(`http://127.0.0.1:${port}/hook`)).toEqual({
      statusCode: 200,
      bodyLimitExceeded: false,
    });
  });

  it('上限を超える応答本文では接続を切る', async () => {
    let finished = false;
    const port = await listen((_request, response) => {
      response.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let sent = 0;
      const push = (): void => {
        while (sent < 8 * 1024 * 1024) {
          sent += chunk.length;
          if (!response.write(chunk)) {
            response.once('drain', push);
            return;
          }
        }
        finished = true;
        response.end();
      };
      push();
    });

    const result = await send(`http://127.0.0.1:${port}/hook`);
    expect(result).toEqual({ statusCode: 200, bodyLimitExceeded: true });
    // 送信先が送り終えるのを待たずに切っている。
    expect(finished).toBe(false);
  });

  it('上限を超える応答ヘッダーを失敗として扱う', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200, { 'x-large': 'a'.repeat(WEBHOOK_MAX_RESPONSE_HEADER_BYTES) }).end();
    });

    await expect(send(`http://127.0.0.1:${port}/hook`)).rejects.toThrow();
  });

  it('中断信号で通信をやめる', async () => {
    const port = await listen(() => {
      // 応答しない。
    });
    const controller = new AbortController();
    const sending = nodeWebhookTransport(
      target(`http://127.0.0.1:${port}/hook`),
      {},
      '{}',
      controller.signal,
    );

    controller.abort();
    await expect(sending).rejects.toThrow();
  });
});
