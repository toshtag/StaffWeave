import type { Database, Queryable } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

function createStubDatabase(overrides: Partial<Database> = {}): Database {
  const base: Database = {
    query: async () => [],
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => fn({ query: async () => [] }),
    ping: async () => {},
    close: async () => {},
  };
  return { ...base, ...overrides };
}

describe('GET /api/health', () => {
  it('外部依存を見ずに 200 を返す', async () => {
    const app = createApp({
      db: createStubDatabase({
        ping: async () => {
          throw new Error('データベースへ到達できません');
        },
      }),
      now: () => new Date('2026-01-15T00:00:00.000Z'),
    });

    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'staffweave',
      checkedAt: '2026-01-15T00:00:00.000Z',
    });
  });
});

describe('GET /api/ready', () => {
  it('データベースへ到達できない場合は 503 を返す', async () => {
    const app = createApp({
      db: createStubDatabase({
        ping: async () => {
          throw new Error('データベースへ到達できません');
        },
      }),
    });

    const response = await app.request('/api/ready');
    const body = (await response.json()) as { status: string; checks: { name: string }[] };

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks).toEqual([
      { name: 'database', ok: false, detail: 'データベースへ到達できません' },
    ]);
  });

  it('未適用のマイグレーションがある場合は 503 を返す', async () => {
    // schema_migrations が空 = すべて未適用。
    const app = createApp({ db: createStubDatabase() });

    const response = await app.request('/api/ready');
    const body = (await response.json()) as {
      status: string;
      checks: { name: string; ok: boolean; detail?: string }[];
    };

    expect(response.status).toBe(503);
    expect(body.checks.find((check) => check.name === 'migrations')?.ok).toBe(false);
  });
});

describe('存在しない API', () => {
  it('404 を JSON で返す', async () => {
    const app = createApp({ db: createStubDatabase() });
    const response = await app.request('/api/unknown');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: '該当する API がありません' },
    });
  });
});
