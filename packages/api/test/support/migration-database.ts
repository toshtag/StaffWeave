import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@staffweave/db';
import { createDatabase, MIGRATIONS_DIR } from '@staffweave/db';
import { afterAll, beforeAll } from 'vitest';
import { requireTestDatabaseUrl } from '../../../../test/integration-setup.js';

/**
 * マイグレーションの検査が使う一時データベース。
 *
 * すでに動いている環境で何が起きるかは、当時の版まで適用したデータベースを
 * 作り直さないと確かめられない。統合テスト用のデータベースをそのまま使うと、
 * 他の検査と適用済みの版が食い違うため、検査ごとに作って消す。
 *
 * 用意と後始末をここへ集める。検査ごとに書くと、後始末を書き落とした検査が
 * データベースを残し、次の実行の失敗が「前回の残り」なのか
 * 「今回の変更」なのか分からなくなる。
 */

/** `TEST_DATABASE_URL` と同じサーバー上の、別のデータベースを指す接続文字列。 */
export function temporaryDatabaseUrl(databaseName: string): string {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * 指定した版までのマイグレーションだけを置いた一時ディレクトリ。
 *
 * 内容は原本と同一にする。書き換えた SQL で検査すると、
 * 確かめているのは実際に配るものではなくなる。
 */
export async function migrationsUpTo(version: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'staffweave-migrations-'));
  for (const fileName of await readdir(MIGRATIONS_DIR)) {
    if (!fileName.endsWith('.sql')) continue;
    if (Number(fileName.slice(0, 4)) > version) continue;
    await copyFile(join(MIGRATIONS_DIR, fileName), join(directory, fileName));
  }
  return directory;
}

export interface TemporaryDatabases {
  /** 名前ごとの接続。最初に取り出したときに開き、検査の終わりに閉じる。 */
  database(name: string): Database;
  /**
   * 追加の接続を開く。
   * 別プロセスからの操作に近い形を作りたい場合にだけ使う。
   */
  connect(name: string, maxConnections?: number): Database;
}

/**
 * 検査用のデータベースを作り、終わったら消す。
 *
 * `prepare` は作成の直後に呼ぶ。ここで当時の版までの適用と、
 * 当時の形のデータの保存を行う。
 *
 * 上限時間は指定しない。統合テストの既定（`vitest.config.ts` の `hookTimeout`）に従う。
 */
export function useTemporaryDatabases(
  names: readonly string[],
  prepare: (databases: TemporaryDatabases) => Promise<void>,
): TemporaryDatabases {
  let admin: Database | undefined;
  const opened: Database[] = [];
  const byName = new Map<string, Database>();

  function connect(name: string, maxConnections = 1): Database {
    const database = createDatabase({
      connectionString: temporaryDatabaseUrl(name),
      maxConnections,
    });
    opened.push(database);
    return database;
  }

  function database(name: string): Database {
    if (!names.includes(name)) {
      throw new Error(`用意していないデータベースです: ${name}`);
    }
    const existing = byName.get(name);
    if (existing) return existing;
    const created = connect(name);
    byName.set(name, created);
    return created;
  }

  const databases: TemporaryDatabases = { database, connect };

  beforeAll(async () => {
    admin = createDatabase({
      connectionString: temporaryDatabaseUrl('postgres'),
      maxConnections: 1,
    });
    for (const name of names) {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.query(`CREATE DATABASE ${name}`);
    }
    await prepare(databases);
  });

  afterAll(async () => {
    // 接続が残っていると DROP が失敗する。検査が途中で落ちても必ず閉じる。
    for (const opened_ of opened) await opened_.close();
    opened.length = 0;
    byName.clear();
    for (const name of names) {
      await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    }
    await admin?.close();
    admin = undefined;
  });

  return databases;
}
