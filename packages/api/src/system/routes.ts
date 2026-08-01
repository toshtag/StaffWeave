import { buildOpenApiDocument } from '@staffweave/contracts';
import type { Database } from '@staffweave/db';
import { getMigrationStatus } from '@staffweave/db';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import type { StructuredLogger } from '../shared/logger.js';

/** 契約文書へ載せる版。実装と契約の対応が追えるよう、リリース時に更新する。 */
export const API_VERSION = '0.2.0';

export interface SystemRouteDependencies {
  db: Database;
  /** 起動時刻の取得。テストから固定値を渡せるようにする。 */
  now: () => Date;
  /** 失敗の詳細を出す先。応答には含めない。 */
  logger: StructuredLogger;
}

interface ReadinessCheck {
  name: string;
  ok: boolean;
  /**
   * 応答へ含めてよい補足。
   *
   * 接続先、利用者名、ファイル名のように、外から見えると構成を推し量れる値は入れない。
   * それらは応答ではなくログへ出す。稼働確認に要るのは、どの検査が落ちたかまで。
   */
  detail?: string;
}

/**
 * 稼働確認用のエンドポイント。
 *
 * - `/health` はプロセスが応答できるかどうかだけを返す（外部依存を見ない）。
 * - `/ready` はデータベース接続とマイグレーション適用状況を確認する。
 * - `/openapi.json` は API 契約そのものを配布する。
 *
 * `/ready` は認証を要求しない。失敗の理由をそのまま返すと、
 * 認証なしで接続先やマイグレーションの構成を読み取れてしまうため、
 * 応答は検査の成否までにとどめ、理由はログへ出す。
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

    const reason = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);

    try {
      await deps.db.ping();
      checks.push({ name: 'database', ok: true });
    } catch (error) {
      // 接続先や利用者名は応答へ出さない。運用者はログで原因を追える。
      deps.logger.error('ready.database_failed', { reason: reason(error) });
      checks.push({ name: 'database', ok: false });
    }

    if (checks[0]?.ok) {
      try {
        const status = await getMigrationStatus(deps.db);
        if (status.changed.length > 0) {
          // 変更されたファイルの名前は応答へ出さない。適用済みの構成が読み取れる。
          deps.logger.error('ready.migrations_changed', {
            fileNames: status.changed.map((file) => file.fileName),
          });
          checks.push({
            name: 'migrations',
            ok: false,
            detail: `適用済みマイグレーションが ${status.changed.length} 件変更されています`,
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
        deps.logger.error('ready.migrations_failed', { reason: reason(error) });
        checks.push({ name: 'migrations', ok: false });
      }
    }

    const ready = checks.every((check) => check.ok);
    return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
  });

  return app;
}
