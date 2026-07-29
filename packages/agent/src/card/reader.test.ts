import { describe, expect, it } from 'vitest';
import { cardFingerprint, createScriptedCardReader, isSameCard } from './reader.js';

const KEY = 'test-card-fingerprint-key';

describe('cardFingerprint', () => {
  it('同じカードからは同じ指紋になる', () => {
    expect(cardFingerprint(KEY, '0123456789ABCDEF')).toBe(cardFingerprint(KEY, '0123456789ABCDEF'));
  });

  it('大文字小文字と前後の空白の違いを吸収する', () => {
    expect(cardFingerprint(KEY, ' 0123456789abcdef ')).toBe(
      cardFingerprint(KEY, '0123456789ABCDEF'),
    );
  });

  it('別のカードは別の指紋になる', () => {
    expect(cardFingerprint(KEY, '0123456789ABCDEF')).not.toBe(
      cardFingerprint(KEY, '0123456789ABCDEE'),
    );
  });

  it('鍵が違えば指紋も変わる', () => {
    expect(cardFingerprint(KEY, '0123456789ABCDEF')).not.toBe(
      cardFingerprint('another-key', '0123456789ABCDEF'),
    );
  });

  it('指紋から元の識別子は読み取れない', () => {
    const fingerprint = cardFingerprint(KEY, '0123456789ABCDEF');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain('0123456789ABCDEF');
  });

  it('空の識別子を拒否する', () => {
    expect(() => cardFingerprint(KEY, '   ')).toThrow(/空です/);
  });
});

describe('isSameCard', () => {
  it('同じ指紋なら true', () => {
    const fingerprint = cardFingerprint(KEY, '0123456789ABCDEF');
    expect(isSameCard(fingerprint, fingerprint)).toBe(true);
  });

  it('違う指紋なら false', () => {
    expect(isSameCard(cardFingerprint(KEY, 'AAAA'), cardFingerprint(KEY, 'BBBB'))).toBe(false);
  });

  it('長さが違っても例外を投げない', () => {
    expect(isSameCard('abc', 'abcd')).toBe(false);
  });
});

describe('createScriptedCardReader', () => {
  it('与えた順に読み取る', async () => {
    const reader = createScriptedCardReader(['CARD-1', 'CARD-2']);
    await expect(reader.read()).resolves.toBe('CARD-1');
    await expect(reader.read()).resolves.toBe('CARD-2');
  });

  it('読み取るものが無くなれば例外を投げる', async () => {
    const reader = createScriptedCardReader(['CARD-1']);
    await reader.read();
    await expect(reader.read()).rejects.toThrow(/読み取れるカードがありません/);
  });
});
