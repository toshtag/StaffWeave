/**
 * 統合テストが、ワーカーごとに別のデータベースを使うことを確かめる。
 *
 * ここが崩れると、あるファイルの消去が別のファイルのデータを消す。
 * 失敗は `workspaces_slug_key` の重複や外部キー違反として現れ、
 * どのファイルが落ちるかは実行のたびに変わる。原因から遠い場所で落ちるため、
 * 実際に 6 回続けて別々のファイルが落ち、原因が分からないまま再実行していた。
 *
 * 以前は `VITEST_POOL_ID`（枠の番号）で名前を決めていた。枠は、前のプロセスが
 * 終わりきる前に次のプロセスへ渡される。計測すると 1 つの枠を 2 つのプロセスが
 * 同時に使っていた。番号が無いときに共有のデータベースへ落ちる分岐もあり、
 * そちらは全ワーカーが 1 つのデータベースを使う状態になる。
 *
 * どちらも「気付かないまま共有する」形なので、両方を検査で止める。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminDatabaseUrl, requireTestDatabaseUrl, workerDatabaseUrl } from './database-url.js';

const BASE = 'postgres://user:pass@localhost:5433/staffweave_test';

let saved: Record<string, string | undefined> = {};

function setEnvironment(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  saved = {
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    VITEST_WORKER_ID: process.env.VITEST_WORKER_ID,
    VITEST_POOL_ID: process.env.VITEST_POOL_ID,
  };
  setEnvironment({ TEST_DATABASE_URL: BASE });
});

afterEach(() => {
  setEnvironment(saved);
});

describe('接続先の検査', () => {
  it('設定が無ければ使わせない', () => {
    setEnvironment({ TEST_DATABASE_URL: undefined });

    expect(() => requireTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
  });

  it('_test で終わらないデータベースを使わせない', () => {
    setEnvironment({ TEST_DATABASE_URL: 'postgres://user:pass@localhost:5433/staffweave' });

    expect(() => requireTestDatabaseUrl()).toThrow(/_test/);
  });

  it('作成と削除は同じサーバーの postgres を指す', () => {
    expect(new URL(adminDatabaseUrl()).pathname).toBe('/postgres');
  });
});

describe('ワーカーごとのデータベース', () => {
  it('ワーカーが違えば名前も違う', () => {
    setEnvironment({ VITEST_WORKER_ID: '7' });
    const first = workerDatabaseUrl();
    setEnvironment({ VITEST_WORKER_ID: '8' });
    const second = workerDatabaseUrl();

    expect(first).not.toBe(second);
    expect(new URL(first).pathname).toBe('/staffweave_test_w7');
    expect(new URL(second).pathname).toBe('/staffweave_test_w8');
  });

  /**
   * 枠の番号は前のプロセスと次のプロセスで重なる。名前の材料に使うと、
   * 2 つのプロセスが同じデータベースへ同時に書き込む。
   */
  it('枠の番号（VITEST_POOL_ID）では名前を決めない', () => {
    setEnvironment({ VITEST_WORKER_ID: '61', VITEST_POOL_ID: '1' });
    const first = workerDatabaseUrl();
    // 同じ枠を、別のワーカーが受け取った状態。
    setEnvironment({ VITEST_WORKER_ID: '62', VITEST_POOL_ID: '1' });
    const second = workerDatabaseUrl();

    expect(first).not.toBe(second);
  });

  /**
   * 番号が無いときに元のデータベースへ落とすと、全ワーカーがそこを共有する。
   * 落ちるのは共有し始めたずっと後なので、原因が分からなくなる。
   */
  it('ワーカーの番号が無ければ、共有のデータベースへ落とさず失敗する', () => {
    setEnvironment({ VITEST_WORKER_ID: undefined });

    expect(() => workerDatabaseUrl()).toThrow(/VITEST_WORKER_ID/);
  });
});
