import type { Database, Queryable } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { silentLogger } from '../logger.js';

function stubDatabase(): Database {
  return {
    query: async () => [],
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => fn({ query: async () => [] }),
    session: async <T>(fn: (connection: Queryable) => Promise<T>) => fn({ query: async () => [] }),
    ping: async () => {},
    close: async () => {},
  };
}

const LIMITS = { defaultMaxBytes: 1024, bulkMaxBytes: 4096 };

function app() {
  return createApp({ db: stubDatabase(), logger: silentLogger, requestBodyLimit: LIMITS });
}

/** 指定した大きさの JSON 本文を作る。 */
function jsonOf(bytes: number): string {
  const body = { email: 'a@example.com', password: 'x'.repeat(bytes) };
  return JSON.stringify(body);
}

describe('要求本文の上限', () => {
  it('上限を超えた要求を 413 で断る', async () => {
    const response = await app().request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonOf(LIMITS.defaultMaxBytes * 2),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'payload_too_large', message: '要求の本文が大きすぎます' },
    });
  });

  it('長さを申告しない要求も、読みながら打ち切る', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(256));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 上限を超えるまで送り続ける。content-length は付かない。
        for (let index = 0; index < 100; index += 1) controller.enqueue(chunk);
        controller.close();
      },
    });

    const response = await app().request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // Node.js の fetch は、ストリームを本文にする場合これを求める。
      duplex: 'half',
    } as RequestInit);

    expect(response.status).toBe(413);
  });

  it('上限内の要求はこれまでどおり処理へ進む', async () => {
    const response = await app().request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(16) }),
    });

    // 認証そのものは失敗するが、上限では断られない。
    expect(response.status).toBe(401);
  });

  it('CSV の取り込みだけは大きい上限を使う', async () => {
    const body = '"organization_code","employee_number","display_name"\n'.padEnd(2048, ' ');

    const overDefault = await app().request('/api/imports/employees', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body,
    });
    // ふつうの上限（1024）は超えるが、取り込みの上限（4096）には収まる。
    // 認証していないため 401 になるが、413 にはならない。
    expect(overDefault.status).toBe(401);

    const overBulk = await app().request('/api/imports/employees', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: body.padEnd(LIMITS.bulkMaxBytes * 2, ' '),
    });
    expect(overBulk.status).toBe(413);
  });
});
