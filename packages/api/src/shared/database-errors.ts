/**
 * PostgreSQL のエラーコードを、ドライバ型に依存せず判定する。
 * 上位パッケージへドライバの型を持ち込まないため、形だけを見る。
 */

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function constraintOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : undefined;
}

/** 一意制約違反（23505）。 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (errorCodeOf(error) !== '23505') return false;
  return constraint === undefined || constraintOf(error) === constraint;
}

/** 外部キー制約違反（23503）。参照先が存在しない、または別ワークスペースの場合に起きる。 */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorCodeOf(error) === '23503';
}

/** 検査制約違反（23514）。 */
export function isCheckViolation(error: unknown): boolean {
  return errorCodeOf(error) === '23514';
}
