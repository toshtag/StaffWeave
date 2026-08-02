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

/**
 * 外部キー制約違反（23503）。
 * 参照先が存在しない場合のほか、ワークスペースや組織が一致しない場合にも起きる。
 */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  if (errorCodeOf(error) !== '23503') return false;
  return constraint === undefined || constraintOf(error) === constraint;
}

/** 排他制約違反（23P01）。期間の重なりのように、行どうしの関係を禁じる制約で起きる。 */
export function isExclusionViolation(error: unknown, constraint?: string): boolean {
  if (errorCodeOf(error) !== '23P01') return false;
  return constraint === undefined || constraintOf(error) === constraint;
}
