import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/** セッショントークンを生成する。利用者へ渡すのはこの値のみ。 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * 保存・照合用のハッシュ。
 * データベースが漏えいしてもトークンを復元できないようにする。
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
