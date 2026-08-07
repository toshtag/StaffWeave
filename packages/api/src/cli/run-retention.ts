/**
 * 保持期間を過ぎた記録を消す。
 *
 *   pnpm retention -- --webhook-deliveries 90 --login-attempts 90
 *   pnpm retention -- --apply --webhook-deliveries 90
 *
 * 既定では消さない。何をどれだけ消すかを出すだけで終わる。
 * `--apply` を付けたときだけ消す。
 *
 * 保持する期間は事業者が決める。製品は既定値を持たない。
 * 渡さなかった対象は消さない。
 *
 * 消す前にバックアップを取ってください（`pnpm backup`）。
 * この command は控えを取りません。
 */

import { createDatabase } from '@staffweave/db';
import { createAuditRepository } from '../audit/repository.js';
import { loadApiConfig } from '../config.js';
import { RETENTION_TARGETS, runRetention } from '../operations/retention.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');

const days = new Map<string, number>();
for (const target of RETENTION_TARGETS) {
  const index = argv.indexOf(`--${target.name}`);
  if (index === -1) continue;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    process.stderr.write(`--${target.name} には 1 以上の整数を渡してください\n`);
    process.exit(2);
  }
  days.set(target.name, value);
}

if (days.size === 0) {
  process.stderr.write('消す対象が渡されていません。次のいずれかを指定してください:\n');
  for (const target of RETENTION_TARGETS) {
    process.stderr.write(`  --${target.name} <日数>\n`);
  }
  process.exit(2);
}

const config = loadApiConfig();
const db = createDatabase({ connectionString: config.databaseUrl });

const workspaces = await db.query<{ id: string; slug: string }>(
  'SELECT id, slug FROM workspaces ORDER BY slug',
);

process.stdout.write(apply ? '消します。\n' : '事前確認です。何も消しません。\n');

// ワークスペースに分かれていない対象は、1 回だけ消す。
// ワークスペースごとに回すと、同じ表を人数ぶん消そうとすることになる。
const globalTargets = RETENTION_TARGETS.filter(
  (target) => target.scope === 'global' && days.has(target.name),
);
const workspaceDays = new Map(
  [...days].filter(([name]) => !globalTargets.some((target) => target.name === name)),
);

let failed = false;

if (globalTargets.length > 0) {
  const first = workspaces[0];
  if (first === undefined) {
    process.stderr.write('ワークスペースがありません\n');
  } else {
    const now = new Date();
    const outcome = await db.transaction((tx) =>
      runRetention(
        { db: tx, audit: createAuditRepository(tx) },
        {
          workspaceId: first.id,
          days: new Map(globalTargets.map((target) => [target.name, days.get(target.name) ?? 0])),
          apply,
          now,
        },
      ),
    );
    process.stdout.write('ワークスペースに分かれていない記録\n');
    for (const row of outcome.rows) {
      process.stdout.write(`  ${row.name}: ${row.before} より前 / ${row.count} 件\n`);
    }
  }
}

if (workspaceDays.size === 0) {
  await db.close();
  process.exit(failed ? 1 : 0);
}

for (const workspace of workspaces) {
  try {
    // 事前確認と実行で「いま」を揃える。別々に取ると、間に時計が進んで
    // 確かめた件数と消した件数が食い違う。
    const now = new Date();
    const outcome = await db.transaction((tx) =>
      runRetention(
        { db: tx, audit: createAuditRepository(tx) },
        { workspaceId: workspace.id, days: workspaceDays, apply, now },
      ),
    );
    process.stdout.write(`${workspace.slug}\n`);
    for (const row of outcome.rows) {
      process.stdout.write(`  ${row.name}: ${row.before} より前 / ${row.count} 件\n`);
    }
  } catch (error) {
    failed = true;
    process.stderr.write(
      `${workspace.slug}: ${error instanceof Error ? error.message : '失敗しました'}\n`,
    );
  }
}

await db.close();
if (failed) process.exit(1);
