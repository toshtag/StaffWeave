import { describe, expect, it } from 'vitest';
import { stubDatabase } from '../../test/support/fake-database.js';
import { createApp } from '../app.js';
import type { StructuredLogger } from '../shared/logger.js';
import { silentLogger } from '../shared/logger.js';

interface LogEntry {
  event: string;
  fields?: Record<string, unknown>;
}

describe('GET /api/health', () => {
  it('外部依存を見ずに 200 を返す', async () => {
    const app = createApp({
      db: stubDatabase({
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
  /** ログへ渡った内容を覚えておく。応答へ出さない詳細をここで確かめる。 */
  function recordingLogger(): { logger: StructuredLogger; entries: LogEntry[] } {
    const entries: LogEntry[] = [];
    return {
      entries,
      logger: {
        info: (event, fields) => entries.push({ event, fields }),
        error: (event, fields) => entries.push({ event, fields }),
      },
    };
  }

  it('データベースへ到達できない場合は 503 を返し、理由を応答へ含めない', async () => {
    const { logger, entries } = recordingLogger();
    const app = createApp({
      logger,
      db: stubDatabase({
        ping: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
        },
      }),
    });

    const response = await app.request('/api/ready');
    const text = await response.text();
    const body = JSON.parse(text) as { status: string; checks: { name: string }[] };

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks).toEqual([{ name: 'database', ok: false }]);
    // 接続先を示す文字列が、どの形でも応答に現れないこと。
    expect(text).not.toContain('10.0.0.5');
    expect(text).not.toContain('ECONNREFUSED');

    expect(entries).toEqual([
      {
        event: 'ready.database_failed',
        fields: { reason: 'connect ECONNREFUSED 10.0.0.5:5432' },
      },
    ]);
  });

  it('未適用のマイグレーションがある場合は 503 を返す', async () => {
    // schema_migrations が空 = すべて未適用。
    const app = createApp({ db: stubDatabase(), logger: silentLogger });

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
    const app = createApp({ db: stubDatabase() });
    const response = await app.request('/api/unknown');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: '該当する API がありません' },
    });
  });
});
