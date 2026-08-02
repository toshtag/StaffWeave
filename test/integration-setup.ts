/**
 * 統合テストの共通準備。
 *
 * - TEST_DATABASE_URL のデータベースへ接続する（開発用とは必ず分ける）。
 * - 全マイグレーションを適用する。
 * - 各テストの前にデータを消し、テスト間の依存を作らない。
 */

import type { Database } from '@staffweave/db';
import { createDatabase, migrate } from '@staffweave/db';
import { afterAll, beforeAll, beforeEach } from 'vitest';

let database: Database | undefined;

export function testDatabase(): Database {
  if (!database) {
    throw new Error('統合テスト用のデータベースが初期化されていません。');
  }
  return database;
}

/**
 * 統合テストが使ってよいデータベースの接続文字列。
 *
 * 名前で誤りを止めるのはここだけにする。検査ごとに読み方を変えると、
 * 経路によって開発データを消せる状態が残る。
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL が設定されていません。docker compose up -d db を実行し、.env を設定してください。',
    );
  }
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(
      `TEST_DATABASE_URL は _test で終わるデータベースを指してください（誤って開発データを消さないため）: ${url}`,
    );
  }
  return url;
}

beforeAll(async () => {
  database = createDatabase({ connectionString: requireTestDatabaseUrl() });
  await migrate(database);
});

beforeEach(async () => {
  const db = testDatabase();
  const tables = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  if (tables.length === 0) return;
  const names = tables.map((row) => `"${row.tablename}"`).join(', ');
  await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await database?.close();
  database = undefined;
});
