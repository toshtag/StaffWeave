import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail, validatePassword } from './credentials.js';

describe('normalizeEmail', () => {
  it('前後の空白を除き小文字化する', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com');
  });
});

describe('isValidEmail', () => {
  it.each([
    ['person@example.com', true],
    ['person.name@example.co.jp', true],
    ['person@example', false],
    ['person example@example.com', false],
    ['@example.com', false],
    ['person@', false],
  ])('%s は %s', (email, expected) => {
    expect(isValidEmail(email)).toBe(expected);
  });
});

describe('validatePassword', () => {
  it('十分な長さと多様性があれば問題なし', () => {
    expect(validatePassword('correct horse battery staple')).toEqual([]);
  });

  it('短いパスワードを拒否する', () => {
    expect(validatePassword('short1')).toContain('too_short');
  });

  it('同じ文字の繰り返しを拒否する', () => {
    expect(validatePassword('aaaaaaaaaaaaaaaa')).toContain('too_simple');
  });

  it('極端に長いパスワードを拒否する', () => {
    expect(validatePassword('a1b2c3d4'.repeat(64))).toContain('too_long');
  });
});
