import type { Database, Queryable, QueryParameter } from '@staffweave/db';

/**
 * テストが使う、作り物のデータベース。
 *
 * 実行用のコードへは入れない。SQL を解釈せず、渡された行をそのまま返すだけで、
 * 本物の代わりにはならない。ここにあるのは「問い合わせの内容を確かめたい」
 * 単体テストのためのものだけとする。
 */

/** 記録した 1 回の問い合わせ。 */
export interface RecordedQuery {
  text: string;
  params: readonly QueryParameter[];
}

/**
 * 問い合わせに対して返す行の決め方。配列を渡すと、どの問い合わせにも同じ行を返す。
 *
 * 行の型は縛らない。作り物は SQL を解釈せず、呼び出し側が「この問い合わせは
 * この形の行を返す」と決めた結果をそのまま渡すだけであるため。
 */
export type FakeRows = readonly unknown[] | ((text: string) => readonly unknown[]);

/** 読み取りにだけ行を返す。更新は行を返さない、という本物の振る舞いへ寄せる。 */
export function onlyReads(rows: readonly unknown[]): FakeRows {
  return (text) => (text.trimStart().startsWith('SELECT') ? rows : []);
}

/** SQL に現れる語で返す行を振り分ける。1 つの経路が複数のテーブルを読む場合に使う。 */
export function byQuery(
  cases: readonly (readonly [pattern: string, rows: readonly unknown[]])[],
  fallback: readonly unknown[] = [],
): FakeRows {
  return (text) => cases.find(([pattern]) => text.includes(pattern))?.[1] ?? fallback;
}

/**
 * 問い合わせを記録する `Queryable`。
 *
 * 返す行は呼び出し側が決める。写し元によって振る舞いが変わらないようにするため、
 * 既定を持たせず、`FakeRows` で明示的に渡す。
 */
export function recordingDatabase(rows: FakeRows): { queries: RecordedQuery[]; db: Queryable } {
  const resolve = typeof rows === 'function' ? rows : () => rows;
  const queries: RecordedQuery[] = [];
  return {
    queries,
    db: {
      query: async <T = Record<string, unknown>>(
        text: string,
        params: readonly QueryParameter[] = [],
      ): Promise<T[]> => {
        queries.push({ text, params });
        return resolve(text) as unknown as T[];
      },
    },
  };
}

/**
 * 何も返さない `Database`。
 *
 * データベースを触らない経路（ヘッダー、本文の上限、送信元の検査、経路の一覧）を
 * 確かめるために置く。個別に振る舞いを変えたい場合は `overrides` で差し替える。
 */
export function stubDatabase(overrides: Partial<Database> = {}): Database {
  return {
    query: async () => [],
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => fn({ query: async () => [] }),
    session: async <T>(fn: (connection: Queryable) => Promise<T>) => fn({ query: async () => [] }),
    ping: async () => {},
    close: async () => {},
    ...overrides,
  };
}
