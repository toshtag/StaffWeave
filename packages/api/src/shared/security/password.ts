import type { ScryptOptions } from 'node:crypto';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt の作業係数。値を変える場合も、保存済みハッシュに含まれる値で照合できることを保つ。
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const ALGORITHM = 'scrypt';

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * パスワードを保存可能な文字列へ変換する。
 * 形式: `scrypt$N$r$p$salt$hash`（salt と hash は base64）
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await deriveKey(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * 保存済みハッシュとパスワードを照合する。
 * 比較は定数時間で行い、一致・不一致の差から情報が漏れないようにする。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const [, costText, blockSizeText, parallelizationText, saltText, hashText] = parts;
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);
  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization)
  ) {
    return false;
  }
  if (saltText === undefined || hashText === undefined) return false;

  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(hashText, 'base64');
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await deriveKey(password.normalize('NFKC'), salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
