/**
 * 組織・拠点・部門・従業員番号に共通する短縮コードの規則。
 * 人が読み書きし、外部システムの取り込みキーにもなるため、揺れを許さない。
 */

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export type CodeProblem = 'empty' | 'too_long' | 'invalid_characters';

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateCode(code: string): CodeProblem[] {
  const normalized = code.trim();
  if (normalized.length === 0) return ['empty'];
  const problems: CodeProblem[] = [];
  if (normalized.length > 32) problems.push('too_long');
  if (!CODE_PATTERN.test(normalized)) problems.push('invalid_characters');
  return problems;
}
