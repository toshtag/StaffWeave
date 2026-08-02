import { describe, expect, it } from 'vitest';
import { InsecureBaseUrlError, isLoopbackHost, requireSecureBaseUrl } from './client-url.js';

/**
 * 秘密情報を送る接続先の判定を固定する。
 *
 * 文字列の見た目で判定すると、`http://2130706433/` のような別表記の
 * ループバックを見落とす。正規化してから判定していることを確かめる。
 */

describe('isLoopbackHost', () => {
  it.each(['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '[::ffff:7f00:1]'])(
    '%s はループバックとして扱う',
    (hostname) => {
      expect(isLoopbackHost(hostname)).toBe(true);
    },
  );

  it.each([
    'example.test',
    '10.0.0.1',
    '192.168.0.1',
    '128.0.0.1',
    '[2001:db8::1]',
    '[::ffff:a00:1]',
  ])('%s はループバックとして扱わない', (hostname) => {
    expect(isLoopbackHost(hostname)).toBe(false);
  });
});

describe('requireSecureBaseUrl', () => {
  it('https の接続先を許す', () => {
    expect(requireSecureBaseUrl('https://staffweave.example/')).toBe('https://staffweave.example');
  });

  it('経路を含む https の接続先を許す', () => {
    expect(requireSecureBaseUrl('https://staffweave.example/attendance/')).toBe(
      'https://staffweave.example/attendance',
    );
  });

  it.each([
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['http://localhost:8787/', 'http://localhost:8787'],
    ['http://[::1]:8787', 'http://[::1]:8787'],
    // 別表記でも、正規化すればループバックだと分かる。
    ['http://2130706433:8787', 'http://127.0.0.1:8787'],
    ['http://127.1:8787', 'http://127.0.0.1:8787'],
  ])('ループバックの http %s を許す', (raw, normalized) => {
    expect(requireSecureBaseUrl(raw)).toBe(normalized);
  });

  it.each([
    'http://staffweave.example',
    'http://203.0.113.10:8787',
    'http://10.0.0.1:8787',
    'http://192.168.0.1:8787',
    'http://[2001:db8::1]:8787',
  ])('ループバック以外の http %s を断る', (raw) => {
    expect(() => requireSecureBaseUrl(raw)).toThrow(/https/);
  });

  it.each([
    ['ftp://staffweave.example', /http または https/],
    ['https://user:secret@staffweave.example', /認証情報/],
    ['https://staffweave.example/#section', /フラグメント/],
    ['https://staffweave.example:0', /ポート番号/],
    ['staffweave.example', /解釈できません/],
  ])('%s を断る', (raw, message) => {
    expect(() => requireSecureBaseUrl(raw)).toThrow(message);
  });

  it('断る理由を InsecureBaseUrlError として投げる', () => {
    expect(() => requireSecureBaseUrl('http://staffweave.example')).toThrow(InsecureBaseUrlError);
  });

  it('呼び出し側が示した名前を伝える', () => {
    expect(() => requireSecureBaseUrl('http://staffweave.example', 'サーバー')).toThrow(
      /^サーバーが暗号化されていません/,
    );
  });
});
