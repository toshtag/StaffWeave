import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, resolveLocale } from './locale.js';

describe('resolveLocale', () => {
  it('完全一致を優先する', () => {
    expect(resolveLocale(['en', 'ja-JP'])).toBe('en');
  });

  it('言語部分の一致でも解決する', () => {
    expect(resolveLocale(['ja'])).toBe('ja-JP');
    expect(resolveLocale(['en-US'])).toBe('en');
  });

  it('対応していない言語なら既定値を返す', () => {
    expect(resolveLocale(['fr-FR'])).toBe('ja-JP');
    expect(resolveLocale([])).toBe('ja-JP');
  });
});

describe('parseAcceptLanguage', () => {
  it('品質値の高い順に並べる', () => {
    expect(parseAcceptLanguage('en;q=0.8, ja-JP;q=0.9, fr;q=0.1')).toEqual(['ja-JP', 'en', 'fr']);
  });

  it('品質値の指定がなければ最優先とみなす', () => {
    expect(parseAcceptLanguage('ja, en;q=0.5')).toEqual(['ja', 'en']);
  });

  it('未指定なら空配列', () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
});
