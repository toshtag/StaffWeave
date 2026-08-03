import type { Database } from '@staffweave/db';
import { migrate } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { useTemporaryDatabases } from '../support/migration-database.js';

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

let first: Database;
let second: Database;

useTemporaryDatabases([CONCURRENT], async ({ connect }) => {
  // 別々の接続の集まりを使い、別プロセスからの適用に近い形にする。
  first = connect(CONCURRENT, 2);
  second = connect(CONCURRENT, 2);
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
    // pg_locks はサーバー全体を映す。データベースで絞らないと、
    // 並列に流している別の検査が取っているロックまで数えてしまう。
    const rows = await first.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_locks
        WHERE locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );

    expect(rows[0]?.count).toBe(0);
  });
});
