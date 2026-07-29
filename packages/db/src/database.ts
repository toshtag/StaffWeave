import pg from 'pg';
import type { Database, Queryable, QueryParameter } from './types.js';

// 型変換の方針:
// - timestamptz は絶対時刻なので Date のまま扱う（ドライバの既定）。
// - date と timestamp（タイムゾーンなし）は、実行環境のタイムゾーンで解釈されると
//   業務日がずれるため、文字列のまま受け取り、必要な場所で明示的に解釈する。
// - numeric は浮動小数へ丸めず文字列で受け取る。
const TIMESTAMP_OID = 1114;
const DATE_OID = 1082;
const NUMERIC_OID = 1700;
const INT8_OID = 20;

pg.types.setTypeParser(TIMESTAMP_OID, (value) => value);
pg.types.setTypeParser(DATE_OID, (value) => value);
pg.types.setTypeParser(NUMERIC_OID, (value) => value);
pg.types.setTypeParser(INT8_OID, (value) => Number(value));

export interface CreateDatabaseOptions {
  connectionString: string;
  maxConnections?: number;
  /** 接続に失敗したときにエラーとするまでのミリ秒。 */
  connectionTimeoutMillis?: number;
}

function toQueryable(executor: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T = Record<string, unknown>>(
      text: string,
      params: readonly QueryParameter[] = [],
    ): Promise<T[]> {
      const result = await executor.query(text, params as unknown[]);
      return result.rows as T[];
    },
  };
}

export function createDatabase(options: CreateDatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });

  // アイドル接続のエラーでプロセスが落ちないようにする。実際の失敗はクエリ実行時に検出する。
  pool.on('error', () => {});

  const base = toQueryable(pool);

  return {
    query: base.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(toQueryable(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async ping(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
