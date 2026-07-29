import { buildOpenApiDocument } from '@staffweave/contracts';
import type { Database } from '@staffweave/db';
import { getMigrationStatus } from '@staffweave/db';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';

/** 契約文書へ載せる版。実装と契約の対応が追えるよう、リリース時に更新する。 */
export const API_VERSION = '0.2.0';

export interface SystemRouteDependencies {
  db: Database;
  /** 起動時刻の取得。テストから固定値を渡せるようにする。 */
  now: () => Date;
}

interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * 稼働確認用のエンドポイント。
 *
 * - `/health` はプロセスが応答できるかどうかだけを返す（外部依存を見ない）。
 * - `/ready` はデータベース接続とマイグレーション適用状況を確認する。
 * - `/openapi.json` は API 契約そのものを配布する。
 */
export function createSystemRoutes(deps: SystemRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/openapi.json', (c) => c.json(buildOpenApiDocument(API_VERSION)));

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'staffweave',
      checkedAt: deps.now().toISOString(),
    }),
  );

  app.get('/ready', async (c) => {
    const checks: ReadinessCheck[] = [];

    try {
      await deps.db.ping();
      checks.push({ name: 'database', ok: true });
    } catch (error) {
      checks.push({
        name: 'database',
        ok: false,
        detail: error instanceof Error ? error.message : '接続に失敗しました',
      });
    }

    if (checks[0]?.ok) {
      try {
        const status = await getMigrationStatus(deps.db);
        if (status.changed.length > 0) {
          checks.push({
            name: 'migrations',
            ok: false,
            detail: `適用済みマイグレーションが変更されています: ${status.changed
              .map((file) => file.fileName)
              .join(', ')}`,
          });
        } else if (status.pending.length > 0) {
          checks.push({
            name: 'migrations',
            ok: false,
            detail: `未適用のマイグレーションが ${status.pending.length} 件あります`,
          });
        } else {
          checks.push({ name: 'migrations', ok: true });
        }
      } catch (error) {
        checks.push({
          name: 'migrations',
          ok: false,
          detail: error instanceof Error ? error.message : '確認に失敗しました',
        });
      }
    }

    const ready = checks.every((check) => check.ok);
    return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
  });

  return app;
}
