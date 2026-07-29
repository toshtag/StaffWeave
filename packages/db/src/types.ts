/**
 * データベース層の公開型。
 * 上位パッケージへ PostgreSQL ドライバの型を漏らさないため、必要最小限だけを定義する。
 */

export type QueryParameter = string | number | boolean | Date | null | undefined | unknown[];

export interface Queryable {
  /** 明示的な SQL を実行し、行の配列を返す。 */
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly QueryParameter[],
  ): Promise<T[]>;
}

export interface Database extends Queryable {
  /**
   * トランザクション内で処理を実行する。
   * コールバックが例外を投げた場合はロールバックする。
   */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** 接続確認。到達できない場合は例外を投げる。 */
  ping(): Promise<void>;
  close(): Promise<void>;
}
