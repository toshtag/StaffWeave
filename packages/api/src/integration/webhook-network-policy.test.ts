import { describe, expect, it } from 'vitest';
import type { WebhookHostResolver, WebhookNetworkPolicyMode } from './webhook-network-policy.js';
import {
  createWebhookNetworkPolicy,
  isAllowedAddress,
  parseWebhookUrl,
  WebhookTargetError,
} from './webhook-network-policy.js';

const PUBLIC_ADDRESS = '93.184.216.34';

function policy(mode: WebhookNetworkPolicyMode, resolver?: WebhookHostResolver) {
  return createWebhookNetworkPolicy({
    mode,
    ...(resolver === undefined ? {} : { resolver }),
  });
}

/** 実際に接続はしない。分類だけを確かめる。 */
describe('isAllowedAddress', () => {
  describe('public-only', () => {
    it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])(
      '公開アドレス %s を許す',
      (address) => {
        expect(isAllowedAddress(address, 'public-only')).toBe(true);
      },
    );

    it.each([
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.0.0.1',
      '192.0.2.1',
      '192.168.0.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
    ])('IPv4 の %s を拒む', (address) => {
      expect(isAllowedAddress(address, 'public-only')).toBe(false);
    });

    it.each([
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::7f00:1',
      '100::',
      '2001:2::1',
      '2001:db8::1',
      '2002::1',
      'fc00::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
    ])('IPv6 の %s を拒む', (address) => {
      expect(isAllowedAddress(address, 'public-only')).toBe(false);
    });

    it('IP アドレスとして読めない値を拒む', () => {
      expect(isAllowedAddress('not-an-address', 'public-only')).toBe(false);
      expect(isAllowedAddress('', 'public-only')).toBe(false);
    });

    it('既定は公開ネットワークだけを許す', () => {
      expect(isAllowedAddress('127.0.0.1')).toBe(false);
      expect(isAllowedAddress(PUBLIC_ADDRESS)).toBe(true);
    });
  });

  describe('allow-local', () => {
    it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '::1', 'fc00::1'])(
      '明示設定で %s を許す',
      (address) => {
        expect(isAllowedAddress(address, 'allow-local')).toBe(true);
      },
    );

    // 内部サービスへ送りたいという要求と、これらへ到達できることは関係がない。
    it.each(['169.254.169.254', '169.254.1.1', 'fe80::1', '0.0.0.0', '224.0.0.1', 'ff02::1'])(
      '明示設定でも %s は拒む',
      (address) => {
        expect(isAllowedAddress(address, 'allow-local')).toBe(false);
      },
    );
  });
});

describe('parseWebhookUrl', () => {
  it.each(['https://example.com/hook', 'http://example.com/hook?a=1'])(
    '%s を受け付ける',
    (rawUrl) => {
      expect(parseWebhookUrl(rawUrl).href).toBe(rawUrl);
    },
  );

  it.each([
    ['URL として読めない', 'not a url'],
    ['file スキーム', 'file:///etc/passwd'],
    ['ftp スキーム', 'ftp://example.com/hook'],
    ['data スキーム', 'data:text/plain,hook'],
    ['javascript スキーム', 'javascript:alert(1)'],
    ['認証情報付き', 'http://user:password@example.com/hook'],
    ['利用者名だけ', 'http://user@example.com/hook'],
    ['フラグメント付き', 'https://example.com/hook#fragment'],
    ['ポート 0', 'http://example.com:0/hook'],
    ['ゾーン識別子付き IPv6', 'http://[fe80::1%25eth0]/hook'],
  ])('%s の URL を拒む', (_label, rawUrl) => {
    expect(() => parseWebhookUrl(rawUrl)).toThrow(WebhookTargetError);
  });
});

describe('createWebhookNetworkPolicy', () => {
  describe('IP を直接書いた送信先', () => {
    it.each([
      'http://127.0.0.1:8787/health',
      'http://10.0.0.1/hook',
      'http://172.16.0.1/hook',
      'http://192.168.0.1/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/hook',
      'http://[fe80::1]/hook',
      'http://[::ffff:127.0.0.1]/hook',
    ])('%s を拒む', async (rawUrl) => {
      await expect(policy('public-only').resolve(rawUrl)).rejects.toThrow(WebhookTargetError);
    });

    // 十進や十六進で書いても、正規化すればループバックであることが分かる。
    it.each(['http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/'])(
      '別表記の %s を拒む',
      async (rawUrl) => {
        await expect(policy('public-only').resolve(rawUrl)).rejects.toThrow(WebhookTargetError);
      },
    );

    it('公開 IP は名前解決せずに許す', async () => {
      const target = await policy('public-only', () => {
        throw new Error('名前解決を呼んではならない');
      }).resolve(`https://${PUBLIC_ADDRESS}/hook`);

      expect(target.address).toBe(PUBLIC_ADDRESS);
      expect(target.family).toBe(4);
    });

    it('allow-local ではループバックを許す', async () => {
      const target = await policy('allow-local').resolve('http://127.0.0.1:8787/hook');
      expect(target.address).toBe('127.0.0.1');
    });
  });

  describe('ホスト名の解決', () => {
    const resolving =
      (...addresses: { address: string; family: 4 | 6 }[]): WebhookHostResolver =>
      async () =>
        addresses;

    it('公開アドレス 1 件を許す', async () => {
      const target = await policy(
        'public-only',
        resolving({ address: PUBLIC_ADDRESS, family: 4 }),
      ).resolve('https://example.test/hook');

      expect(target).toEqual({
        url: new URL('https://example.test/hook'),
        address: PUBLIC_ADDRESS,
        family: 4,
      });
    });

    it('公開の IPv4 と IPv6 が混ざっていても許す', async () => {
      const target = await policy(
        'public-only',
        resolving(
          { address: '2606:4700:4700::1111', family: 6 },
          { address: PUBLIC_ADDRESS, family: 4 },
        ),
      ).resolve('https://example.test/hook');

      // 応答順をそのまま使う。安全なものを選び直す余地を作らない。
      expect(target.address).toBe('2606:4700:4700::1111');
      expect(target.family).toBe(6);
    });

    it('内部アドレスだけを返すホストを拒む', async () => {
      await expect(
        policy('public-only', resolving({ address: '10.0.0.5', family: 4 })).resolve(
          'https://example.test/hook',
        ),
      ).rejects.toThrow('許可されていないアドレス');
    });

    // 公開アドレスを混ぜれば通る、という抜け道を残さない。
    it('公開と内部が混ざった結果はホストごと拒む', async () => {
      await expect(
        policy(
          'public-only',
          resolving({ address: PUBLIC_ADDRESS, family: 4 }, { address: '127.0.0.1', family: 4 }),
        ).resolve('https://example.test/hook'),
      ).rejects.toThrow('許可されていないアドレス');
    });

    it('結果が 0 件なら拒む', async () => {
      await expect(
        policy('public-only', resolving()).resolve('https://example.test/hook'),
      ).rejects.toThrow('名前を解決できません');
    });

    it('解決器の例外を利用者向けの文言へ変える', async () => {
      await expect(
        policy('public-only', async () => {
          throw new Error('getaddrinfo ENOTFOUND example.test');
        }).resolve('https://example.test/hook'),
      ).rejects.toThrow('Webhook 送信先の名前を解決できません');
    });

    it('種別がアドレスと食い違う結果を拒む', async () => {
      await expect(
        policy('public-only', resolving({ address: PUBLIC_ADDRESS, family: 6 })).resolve(
          'https://example.test/hook',
        ),
      ).rejects.toThrow('解釈できません');
    });

    it('同じアドレスが重複しても扱える', async () => {
      const target = await policy(
        'public-only',
        resolving({ address: PUBLIC_ADDRESS, family: 4 }, { address: PUBLIC_ADDRESS, family: 4 }),
      ).resolve('https://example.test/hook');

      expect(target.address).toBe(PUBLIC_ADDRESS);
    });

    it('登録時と送信時で違う結果を返す解決器を扱える', async () => {
      const answers = [
        [{ address: PUBLIC_ADDRESS, family: 4 as const }],
        [{ address: '127.0.0.1', family: 4 as const }],
      ];
      const rebinding: WebhookHostResolver = async () => answers.shift() ?? [];
      const target = policy('public-only', rebinding);

      await expect(target.resolve('https://example.test/hook')).resolves.toMatchObject({
        address: PUBLIC_ADDRESS,
      });
      await expect(target.resolve('https://example.test/hook')).rejects.toThrow(
        '許可されていないアドレス',
      );
    });

    it('拒否の理由にアドレスの値を含めない', async () => {
      await expect(
        policy('public-only', resolving({ address: '10.1.2.3', family: 4 })).resolve(
          'https://example.test/hook',
        ),
      ).rejects.toThrow(/^(?!.*10\.1\.2\.3).*$/);
    });
  });

  it('正規化した URL を返す', async () => {
    const target = await policy('allow-local').resolve('HTTP://127.0.0.1:8787/hook?b=1');
    expect(target.url.href).toBe('http://127.0.0.1:8787/hook?b=1');
  });
});
