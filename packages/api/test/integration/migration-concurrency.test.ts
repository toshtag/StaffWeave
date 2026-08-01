import type { Database } from '@staffweave/db';
import { createDatabase, migrate } from '@staffweave/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * マイグレーションを同時に走らせても、両方が正常に終わることを固定する。
 *
 * 複数のインスタンスを同時に起動すると、同じマイグレーションが並行して適用されうる。
 * `CREATE TABLE` は片方が重複で失敗し、起動そのものが失敗する。
 * 適用を直列化し、待っていた側は適用済みの状態を読み直して何もしないことを確かめる。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const CONCURRENT = 'staffweave_migration_concurrency_test';

function urlFor(databaseName: string): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL が設定されていません。');
  const url = new URL(base);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

let admin: Database;
let first: Database;
let second: Database;

beforeAll(async () => {
  admin = createDatabase({ connectionString: urlFor('postgres'), maxConnections: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${CONCURRENT}`);
  await admin.query(`CREATE DATABASE ${CONCURRENT}`);

  // 別々の接続の集まりを使い、別プロセスからの適用に近い形にする。
  first = createDatabase({ connectionString: urlFor(CONCURRENT), maxConnections: 2 });
  second = createDatabase({ connectionString: urlFor(CONCURRENT), maxConnections: 2 });
});

afterAll(async () => {
  await first?.close();
  await second?.close();
  await admin?.query(`DROP DATABASE IF EXISTS ${CONCURRENT}`);
  await admin?.close();
});

describe('同時に走らせたマイグレーション', () => {
  it('両方とも失敗せず、適用は 1 度きりになる', async () => {
    const [left, right] = await Promise.all([migrate(first), migrate(second)]);

    // 先に取った側がすべて適用し、待っていた側は適用済みとして何もしない。
    const applied = [...left.appliedVersions, ...right.appliedVersions];
    expect(applied.length).toBeGreaterThan(0);
    expect(new Set(applied).size).toBe(applied.length);
    expect(left.appliedVersions.length === 0 || right.appliedVersions.length === 0).toBe(true);
  }, 120_000);

  it('記録された版に重複が無い', async () => {
    const rows = await first.query<{ version: number; count: number }>(
      'SELECT version, count(*)::int AS count FROM schema_migrations GROUP BY version',
    );

    expect(rows.every((row) => row.count === 1)).toBe(true);
  });

  it('適用のあとにロックが残らない', async () => {
    const rows = await first.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'",
    );

    expect(rows[0]?.count).toBe(0);
  });
});
