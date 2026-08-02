import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRequestError, enroll, sendEvent } from './client.js';
import { generateKeyPair } from './credentials.js';

/**
 * 検査していない宛先へ秘密情報を出さないことを固定する。
 *
 * 接続先を確かめられるのは、設定した URL に対してだけ。リダイレクトへ追従すると、
 * 登録トークンや署名付きの打刻が、確かめていない宛先へ出る。
 * 307 と 308 は手法と本文を保つため、そのまま再送される。
 *
 * 通信はループバックの中だけで完結させ、外部のサーバーへは接続しない。
 * 使うのは明らかにテスト用の値だけで、実在するトークンは扱わない。
 */

const ENROLLMENT_TOKEN = 'test-enrollment-token';

interface Arrival {
  path: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

const servers: Server[] = [];

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

/** 届いた要求を記録するだけのサーバー。 */
async function recordingServer(arrivals: Arrival[]): Promise<number> {
  return listen((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      arrivals.push({ path: request.url ?? '', body, headers: request.headers });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"deviceId":"device-1","workspaceSlug":"default","device":{"lastSequence":0}}');
    });
  });
}

function credentials(baseUrl: string) {
  const keyPair = generateKeyPair();
  return {
    baseUrl,
    deviceId: '00000000-0000-4000-8000-000000000000',
    workspaceSlug: 'default',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
    nextSequence: 1,
  };
}

const event = {
  sequence: 1,
  requestId: 'test-request-id',
  employeeNumber: 'E001',
  eventType: 'clock_in' as const,
  occurredAt: '2026-04-01T00:00:00.000Z',
  deviceTime: '2026-04-01T00:00:00.000Z',
};

beforeEach(() => {
  servers.length = 0;
});

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('リダイレクトの扱い', () => {
  // 301・302・303 は本文を落とすが、要求そのものは未検査の宛先へ届く。
  // 307・308 は手法と本文を保つため、登録トークンがそのまま再送される。
  it.each([301, 302, 303, 307, 308])('%d に追従せず、転送先へ要求を出さない', async (status) => {
    const arrivals: Arrival[] = [];
    const target = await recordingServer(arrivals);
    const redirector = await listen((_request, response) => {
      response.writeHead(status, { location: `http://127.0.0.1:${target}/moved` });
      response.end();
    });

    const error = await enroll(`http://127.0.0.1:${redirector}`, {
      enrollmentToken: ENROLLMENT_TOKEN,
      publicKey: generateKeyPair().publicKeyPem,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AgentRequestError);
    expect(error).toMatchObject({ status, code: 'redirect_not_followed' });
    expect(arrivals).toEqual([]);
  });

  it('別ホストへの転送にも追従しない', async () => {
    const arrivals: Arrival[] = [];
    const target = await recordingServer(arrivals);
    const redirector = await listen((_request, response) => {
      // 同じループバックでもポートが違えば別のオリジン。
      response.writeHead(307, { location: `http://localhost:${target}/moved` });
      response.end();
    });

    await expect(
      enroll(`http://127.0.0.1:${redirector}`, {
        enrollmentToken: ENROLLMENT_TOKEN,
        publicKey: generateKeyPair().publicKeyPem,
      }),
    ).rejects.toBeInstanceOf(AgentRequestError);
    expect(arrivals).toEqual([]);
  });

  it('経路だけを変える相対の転送にも追従しない', async () => {
    const arrivals: Arrival[] = [];
    const redirector = await listen((request, response) => {
      if (request.url === '/moved') {
        let body = '';
        request.on('data', (chunk) => {
          body += String(chunk);
        });
        request.on('end', () => {
          arrivals.push({ path: request.url ?? '', body, headers: request.headers });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{}');
        });
        return;
      }
      response.writeHead(307, { location: '/moved' });
      response.end();
    });

    await expect(
      enroll(`http://127.0.0.1:${redirector}`, {
        enrollmentToken: ENROLLMENT_TOKEN,
        publicKey: generateKeyPair().publicKeyPem,
      }),
    ).rejects.toBeInstanceOf(AgentRequestError);
    expect(arrivals).toEqual([]);
  });

  // 公開ネットワークへ出ないことは、経路の無い文書用アドレスで確かめる。
  it('ループバックから公開アドレスへ追従しない', async () => {
    const redirector = await listen((_request, response) => {
      response.writeHead(307, { location: 'http://203.0.113.10/moved' });
      response.end();
    });

    const started = Date.now();
    const error = await enroll(`http://127.0.0.1:${redirector}`, {
      enrollmentToken: ENROLLMENT_TOKEN,
      publicKey: generateKeyPair().publicKeyPem,
    }).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'redirect_not_followed' });
    // 接続を試みていれば待ち時間が出る。その場で断っていることを見る。
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('署名付きの打刻でも転送先へ要求を出さない', async () => {
    const arrivals: Arrival[] = [];
    const target = await recordingServer(arrivals);
    const redirector = await listen((_request, response) => {
      response.writeHead(308, { location: `http://127.0.0.1:${target}/moved` });
      response.end();
    });

    await expect(
      sendEvent(credentials(`http://127.0.0.1:${redirector}`), event),
    ).rejects.toMatchObject({ code: 'redirect_not_followed' });
    expect(arrivals).toEqual([]);
  });

  it('断る理由に登録トークンも転送先も含めない', async () => {
    const target = await recordingServer([]);
    const location = `http://127.0.0.1:${target}/moved`;
    const redirector = await listen((_request, response) => {
      response.writeHead(307, { location });
      response.end();
    });

    const error = (await enroll(`http://127.0.0.1:${redirector}`, {
      enrollmentToken: ENROLLMENT_TOKEN,
      publicKey: generateKeyPair().publicKeyPem,
    }).catch((thrown: unknown) => thrown)) as AgentRequestError;

    expect(error.message).not.toContain(ENROLLMENT_TOKEN);
    expect(error.message).not.toContain(location);
    expect(JSON.stringify(error)).not.toContain(ENROLLMENT_TOKEN);
  });

  it('転送でない応答はこれまでどおり扱う', async () => {
    const arrivals: Arrival[] = [];
    const server = await recordingServer(arrivals);

    const result = await enroll(`http://127.0.0.1:${server}`, {
      enrollmentToken: ENROLLMENT_TOKEN,
      publicKey: generateKeyPair().publicKeyPem,
    });

    expect(result.deviceId).toBe('device-1');
    expect(arrivals).toHaveLength(1);
  });
});
