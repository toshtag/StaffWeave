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
import { requireTestDatabaseUrl } from './database-url.js';

let database: Database | undefined;

export function testDatabase(): Database {
  if (!database) {
    throw new Error('統合テスト用のデータベースが初期化されていません。');
  }
  return database;
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
