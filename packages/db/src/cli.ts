/**
 * マイグレーション用の最小 CLI。
 *
 *   pnpm db:migrate   未適用のマイグレーションを適用する
 *   pnpm db:status    適用状況を表示する
 */
import { createDatabase } from './database.js';
import { getMigrationStatus, migrate } from './migrator.js';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL が設定されていません。.env.example を参考に設定してください。');
  }
  return url;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  const db = createDatabase({ connectionString: requireDatabaseUrl() });

  try {
    if (command === 'up') {
      const result = await migrate(db);
      if (result.appliedVersions.length === 0) {
        console.log('適用すべきマイグレーションはありません。');
      } else {
        console.log(`適用しました: ${result.appliedVersions.join(', ')}`);
      }
      return;
    }

    if (command === 'status') {
      const status = await getMigrationStatus(db);
      console.log(`適用済み: ${status.applied.length} 件`);
      for (const row of status.applied) {
        console.log(`  ${String(row.version).padStart(4, '0')}_${row.name}`);
      }
      console.log(`未適用: ${status.pending.length} 件`);
      for (const file of status.pending) {
        console.log(`  ${file.fileName}`);
      }
      if (status.changed.length > 0) {
        console.log(`変更検出: ${status.changed.map((file) => file.fileName).join(', ')}`);
        process.exitCode = 1;
      }
      return;
    }

    throw new Error(`不明なコマンドです: ${command}（up または status を指定してください）`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
