import type { Database } from '@staffweave/db';
import { getMigrationStatus } from '@staffweave/db';
import { Hono } from 'hono';

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
 */
export function createSystemRoutes(deps: SystemRouteDependencies): Hono {
  const app = new Hono();

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
