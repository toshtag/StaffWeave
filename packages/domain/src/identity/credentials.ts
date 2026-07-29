/**
 * 認証情報にまつわる規則。
 * ハッシュ計算そのものは実装層（api）が行い、ここでは判断基準だけを持つ。
 */

export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 256;

export type PasswordProblem = 'too_short' | 'too_long' | 'too_simple';

/**
 * メールアドレスの正規化。
 * 大文字小文字の違いだけで別アカウントが作られないようにする。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
}

/**
 * パスワードの最低条件。
 * 長さを主軸にし、記号の強制など覚えにくさだけが増える条件は課さない。
 */
export function validatePassword(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < MINIMUM_PASSWORD_LENGTH) problems.push('too_short');
  if (password.length > MAXIMUM_PASSWORD_LENGTH) problems.push('too_long');
  if (new Set(password).size < 5) problems.push('too_simple');
  return problems;
}
