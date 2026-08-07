/**
 * 休暇の自動付与を 1 回だけ動かす。
 *
 *   pnpm --filter "@staffweave/api" leave-grants
 *
 * 毎日 1 回、cron や systemd timer から呼ぶことを想定している。
 * 常駐しないのは、付与が「日に 1 回で足りる処理」で、常駐させると
 * 動いているかどうかを別に見張る必要が出るため。
 *
 * 止まっていた期間は、次に動いたときに日ごとに追いつく。
 * 同じ日を二度付与しないことは実行の記録が担保するため、
 * 1 日に何度呼んでも結果は変わらない。
 *
 * 終了コードは、処理そのものが失敗したときだけ 0 以外にする。
 * 付与が 0 件でも失敗ではない。対象が誰も居ない日はふつうにある。
 */

import { createDatabase } from '@staffweave/db';
import { createAuditRepository } from '../audit/repository.js';
import { loadApiConfig } from '../config.js';
import { createLeaveGrantScheduler } from '../leave/grant-scheduler.js';
import { createLeaveRepository } from '../leave/repository.js';
import { createConsoleLogger } from '../shared/logger.js';

const config = loadApiConfig();
const logger = createConsoleLogger('leave-grants');
const db = createDatabase({ connectionString: config.databaseUrl });

const scheduler = createLeaveGrantScheduler({
  listWorkspaces: async () =>
    db
      .query<{ id: string; slug: string; time_zone: string }>(
        'SELECT id, slug, time_zone FROM workspaces ORDER BY slug',
      )
      .then((rows) => rows.map((row) => ({ id: row.id, slug: row.slug, timeZone: row.time_zone }))),
  now: () => new Date(),
  transaction: (fn) =>
    db.transaction((tx) =>
      fn({ leave: createLeaveRepository(tx), audit: createAuditRepository(tx) }),
    ),
  logger,
});

try {
  const summaries = await scheduler.run();
  const granted = summaries.reduce((total, summary) => total + summary.grantedCount, 0);
  logger.info('leave.grants.finished', { days: summaries.length, granted });
} catch (error) {
  logger.error('leave.grants.failed', { message: error instanceof Error ? error.message : '不明' });
  await db.close();
  process.exit(1);
}

await db.close();
