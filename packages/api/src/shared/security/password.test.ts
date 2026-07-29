import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { generateToken, hashToken } from './tokens.js';

describe('hashPassword / verifyPassword', () => {
  it('同じパスワードを照合できる', async () => {
    const stored = await hashPassword('staffweave test pass');
    await expect(verifyPassword('staffweave test pass', stored)).resolves.toBe(true);
  });

  it('異なるパスワードは一致しない', async () => {
    const stored = await hashPassword('staffweave test pass');
    await expect(verifyPassword('staffweave test pas', stored)).resolves.toBe(false);
  });

  it('毎回異なるソルトを使う', async () => {
    const first = await hashPassword('staffweave test pass');
    const second = await hashPassword('staffweave test pass');
    expect(first).not.toBe(second);
  });

  it('保存形式が壊れていても例外を投げず false を返す', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$a$b$c$d$e')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });

  it('Unicode 正規化の違いを吸収する', async () => {
    // 濁点付き文字は合成済みと分解済みの 2 通りの表現がある。
    const stored = await hashPassword('パスワードがぎこちない');
    await expect(verifyPassword('パスワードがぎこちない'.normalize('NFD'), stored)).resolves.toBe(
      true,
    );
  });
});

describe('セッショントークン', () => {
  it('毎回異なる値を生成する', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('ハッシュは決定的で、元の値を含まない', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});
