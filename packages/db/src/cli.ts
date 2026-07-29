/**
 * マイグレーション用の最小 CLI。
 *
 *   pnpm db:migrate   未適用のマイグレーションを適用する
 *   pnpm db:status    適用状況を表示する
 *   pnpm db:verify    適用が完了し、内容が変更されていないことを確かめる
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

    if (command === 'verify') {
      // 適用漏れと、適用済みファイルの変更をまとめて検査する。
      // 検証の場では「動くかどうか」より「意図せず変わっていないか」を先に見る。
      const status = await getMigrationStatus(db);
      const problems: string[] = [];

      if (status.pending.length > 0) {
        problems.push(`未適用が ${status.pending.length} 件あります`);
      }
      if (status.changed.length > 0) {
        problems.push(
          `適用済みの内容が変更されています: ${status.changed.map((file) => file.fileName).join(', ')}`,
        );
      }

      if (problems.length > 0) {
        for (const problem of problems) console.error(problem);
        process.exitCode = 1;
        return;
      }

      console.log(`適用済み ${status.applied.length} 件。未適用と変更はありません。`);
      return;
    }

    throw new Error(`不明なコマンドです: ${command}（up / status / verify を指定してください）`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
