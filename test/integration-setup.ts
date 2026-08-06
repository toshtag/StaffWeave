/**
 * 統合テストの共通準備。
 *
 * - そのワーカー専用のデータベースへ接続する（開発用とは必ず分ける）。
 * - 全マイグレーションを適用する。
 * - 各テストの前にデータを消し、テスト間の依存を作らない。
 *
 * 読み取りだけを確かめる describe は `useSharedData` で消去を止められる。
 */

import type { Database } from '@staffweave/db';
import { createDatabase, migrate } from '@staffweave/db';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { adminDatabaseUrl, workerDatabaseUrl } from './database-url.js';

let database: Database | undefined;

/** `useSharedData` を使う describe の実行中だけ真。 */
let sharing = false;

export function testDatabase(): Database {
  if (!database) {
    throw new Error('統合テスト用のデータベースが初期化されていません。');
  }
  return database;
}

/** マイグレーションの記録を除いた、データを持つ表の名前。 */
async function dataTables(): Promise<string[]> {
  const rows = await testDatabase().query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
      ORDER BY tablename`,
  );
  return rows.map((row) => row.tablename);
}

async function clearData(): Promise<void> {
  const tables = await dataTables();
  if (tables.length === 0) return;
  const names = tables.map((name) => `"${name}"`).join(', ');
  await testDatabase().query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

/** 表ごとの行数。準備を共有している間に増減が起きていないかを見るために使う。 */
async function rowCounts(): Promise<string> {
  const tables = await dataTables();
  if (tables.length === 0) return '';
  const columns = tables.map((name) => `(SELECT count(*) FROM "${name}") AS "${name}"`).join(', ');
  const rows = await testDatabase().query<Record<string, number>>(`SELECT ${columns}`);
  return JSON.stringify(rows[0] ?? {});
}

/** 接続文字列からデータベース名を取り出す。 */
function databaseNameOf(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.slice(1));
}

/**
 * ワーカー専用のデータベースを、無ければ作る。
 *
 * 名前はワーカーごとに違う（`database-url.ts`）。同時に生きているワーカーの間で
 * 重ならないため、作る対象も書き込む先も重ならない。
 */
async function ensureDatabase(connectionString: string): Promise<void> {
  const name = databaseNameOf(connectionString);
  const admin = createDatabase({ connectionString: adminDatabaseUrl(), maxConnections: 1 });
  try {
    const rows = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.close();
  }
}

/**
 * 使い終わったワーカー専用のデータベースを消す。
 *
 * ワーカーの番号は実行のたびに変わるため、残すと数だけが増えていく。
 * 消せなくても検査は落とさない。接続が残っているなど、後片付けの失敗が
 * テストの結果を書き換えると、何が壊れたのか読めなくなる。
 */
async function dropDatabase(connectionString: string): Promise<void> {
  const name = databaseNameOf(connectionString);
  const admin = createDatabase({ connectionString: adminDatabaseUrl(), maxConnections: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } catch {
    // 残っても次の実行で作り直せる。
  } finally {
    await admin.close();
  }
}

let workerDatabase = '';

beforeAll(async () => {
  workerDatabase = workerDatabaseUrl();
  await ensureDatabase(workerDatabase);
  database = createDatabase({ connectionString: workerDatabase });
  await migrate(database);
});

beforeEach(async () => {
  if (sharing) return;
  await clearData();
});

afterAll(async () => {
  await database?.close();
  database = undefined;
  if (workerDatabase) await dropDatabase(workerDatabase);
});

/**
 * 準備を describe ごとに 1 度だけ作り、テストの間はそのまま保つ。
 *
 * 読み取りだけを確かめるテストは、テストごとに準備を作り直しても結果が変わりません。
 * それでも作り直すと、準備の時間が件数の分だけ積み上がります。
 * 閲覧範囲の検証（55 件）では 1 件あたり 0.86 秒で、そのほとんどが準備でした。
 *
 * 使えるのは、その describe のテストがデータを書き換えない場合だけです。
 * 1 件でも書き換えると、後に続くテストが前のテストの結果を見ることになります。
 * 気付かずに置かれるのを防ぐため、テストごとに表の行数を照合し、
 * 増減があればその場で落とします（値の書き換えまでは見ません）。
 */
export function useSharedData<T>(build: () => Promise<T>): () => T {
  let shared: T | undefined;
  let expected = '';

  beforeAll(async () => {
    await clearData();
    shared = await build();
    expected = await rowCounts();
    sharing = true;
  });

  afterEach(async () => {
    const actual = await rowCounts();
    if (actual === expected) return;
    // ここで消去へ戻すと、後に続くテストは「データが無い」で落ちる。
    // 原因の書き換えから離れた失敗になるため、共有は保ったままにする。
    // 以降のテストも同じ理由で落ち、どの describe が壊れているかが読み取れる。
    throw new Error(
      '共有している準備のデータが、作ったときと変わっています。' +
        'この describe のテストはデータを書き換えないことが前提です。' +
        '書き換えるテストを置く場合は useSharedData を使わないでください。',
    );
  });

  afterAll(() => {
    sharing = false;
  });

  return () => {
    if (shared === undefined) {
      throw new Error('共有する準備がまだ作られていません。');
    }
    return shared;
  };
}
