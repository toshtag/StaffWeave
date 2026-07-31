/**
 * Webhook 送信先の検査。
 *
 * URL の構文、名前解決、接続先アドレスの分類をここへまとめる。
 * 登録時と送信時の両方から同じ判断を通し、二つの経路で基準がずれないようにする。
 *
 * 判定は「接続してよいアドレスか」だけを見る。宛先が実在するかは確かめない。
 * 分類には Node.js 標準の `net.BlockList` を使い、外部の IP 解析ライブラリは足さない。
 */

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** 送信先として許すネットワークの範囲。 */
export type WebhookNetworkPolicyMode = 'public-only' | 'allow-local';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** ホスト名から接続先候補を得る。テストから差し替えられるようにする。 */
export type WebhookHostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** 検査を通った送信先。HTTP はこのアドレスへ接続する。 */
export interface ResolvedWebhookTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

/**
 * 送信先を使えない理由。
 *
 * メッセージはそのまま利用者へ見せる。解決したアドレスの値は含めない。
 * 含めると、登録を試すだけで内部ネットワークの構成を読み取れてしまう。
 */
export class WebhookTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookTargetError';
  }
}

/**
 * 既定で拒む IPv4 の範囲。
 *
 * ループバック・私設・リンクローカルに加え、文書用・試験用・予約済みも拒む。
 * 到達しない宛先を許す利点はなく、分類の穴は将来の抜け道になる。
 */
const DENIED_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // 未指定
  ['10.0.0.0', 8], // 私設
  ['100.64.0.0', 10], // Carrier-grade NAT
  ['127.0.0.0', 8], // ループバック
  ['169.254.0.0', 16], // リンクローカル（メタデータサービスを含む）
  ['172.16.0.0', 12], // 私設
  ['192.0.0.0', 24], // IETF プロトコル割り当て
  ['192.0.2.0', 24], // 文書用 TEST-NET-1
  ['192.168.0.0', 16], // 私設
  ['198.18.0.0', 15], // ベンチマーク用
  ['198.51.100.0', 24], // 文書用 TEST-NET-2
  ['203.0.113.0', 24], // 文書用 TEST-NET-3
  ['224.0.0.0', 4], // マルチキャスト
  ['240.0.0.0', 4], // 予約済み（255.255.255.255 を含む）
];

/**
 * 既定で拒む IPv6 の範囲。
 *
 * `::ffff:0:0/96` は IPv4 射影アドレスすべてを含む。IPv6 の書き方をしていても
 * 実体は IPv4 であり、公開扱いにすると `[::ffff:127.0.0.1]` で内部へ抜けられる。
 */
const DENIED_IPV6: readonly (readonly [string, number])[] = [
  ['::', 128], // 未指定
  ['::1', 128], // ループバック
  ['::', 96], // IPv4 互換（廃止）
  ['::ffff:0:0', 96], // IPv4 射影
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // NAT64 ローカル
  ['100::', 64], // 破棄用
  ['2001:2::', 48], // ベンチマーク用
  ['2001:db8::', 32], // 文書用
  ['2002::', 16], // 6to4
  ['fc00::', 7], // ユニークローカル
  ['fe80::', 10], // リンクローカル
  ['fec0::', 10], // サイトローカル（廃止）
  ['ff00::', 8], // マルチキャスト
];

/**
 * `allow-local` で追加して許す範囲。
 *
 * リンクローカルとメタデータサービスは含めない。これらは「内部サービスへ送りたい」
 * という要求とは関係がなく、許してもクラウドの資格情報を晒す危険だけが増える。
 */
const LOCAL_IPV4: readonly (readonly [string, number])[] = [
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

const LOCAL_IPV6: readonly (readonly [string, number])[] = [
  ['::1', 128],
  ['fc00::', 7],
];

/**
 * 種別ごとに別の一覧へ入れる。
 *
 * `net.BlockList` は IPv4 アドレスを IPv4 射影の形へ直してから IPv6 の範囲とも
 * 突き合わせる。同じ一覧へ `::ffff:0:0/96` を入れると、公開の IPv4 まで一致してしまう。
 */
function matcherOf(
  ipv4: readonly (readonly [string, number])[],
  ipv6: readonly (readonly [string, number])[],
): (address: string, version: 4 | 6) => boolean {
  const v4 = new BlockList();
  for (const [address, prefix] of ipv4) v4.addSubnet(address, prefix, 'ipv4');
  const v6 = new BlockList();
  for (const [address, prefix] of ipv6) v6.addSubnet(address, prefix, 'ipv6');

  return (address, version) =>
    version === 4 ? v4.check(address, 'ipv4') : v6.check(address, 'ipv6');
}

const isDenied = matcherOf(DENIED_IPV4, DENIED_IPV6);
const isLocal = matcherOf(LOCAL_IPV4, LOCAL_IPV6);

/** そのアドレスへ接続してよいか。 */
export function isAllowedAddress(
  address: string,
  mode: WebhookNetworkPolicyMode = 'public-only',
): boolean {
  const version = isIP(address);
  if (version === 0) return false;

  const family = version === 4 ? 4 : 6;
  if (!isDenied(address, family)) return true;
  // 拒否範囲のうち、明示設定で解禁したものだけを通す。
  return mode === 'allow-local' && isLocal(address, family);
}

/** IPv6 リテラルの角括弧を外す。`net` と `dns` はどちらも括弧なしを扱う。 */
function bareHostname(url: URL): string {
  const hostname = url.hostname;
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * URL の構文を検査し、正規化した URL を返す。
 *
 * 判断は WHATWG の `URL` に解析させてから行う。文字列へ正規表現を当てるだけでは、
 * `http://2130706433/` のような別表記のループバックを見落とす。
 */
export function parseWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookTargetError('Webhook 送信先の URL を解釈できません');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookTargetError('Webhook 送信先には http または https の URL を指定してください');
  }
  if (url.username !== '' || url.password !== '') {
    throw new WebhookTargetError('Webhook 送信先の URL に認証情報を含められません');
  }
  // 断片は送信されず、受け取り側にも届かない。書けてしまうと意味のない差異が保存される。
  if (url.hash !== '') {
    throw new WebhookTargetError('Webhook 送信先の URL にフラグメントを含められません');
  }
  if (bareHostname(url) === '') {
    throw new WebhookTargetError('Webhook 送信先の URL にホスト名がありません');
  }
  if (url.port === '0') {
    throw new WebhookTargetError('Webhook 送信先の URL のポート番号が不正です');
  }

  return url;
}

export interface WebhookNetworkPolicy {
  /** URL を検査し、名前解決した全アドレスを確かめて、接続先を一つ決める。 */
  resolve(rawUrl: string): Promise<ResolvedWebhookTarget>;
}

export interface WebhookNetworkPolicyDependencies {
  mode: WebhookNetworkPolicyMode;
  resolver?: WebhookHostResolver;
}

const defaultResolver: WebhookHostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({
    address: result.address,
    family: result.family === 6 ? 6 : 4,
  }));
};

export function createWebhookNetworkPolicy(
  deps: WebhookNetworkPolicyDependencies,
): WebhookNetworkPolicy {
  const resolve = deps.resolver ?? defaultResolver;

  return {
    async resolve(rawUrl) {
      const url = parseWebhookUrl(rawUrl);
      const hostname = bareHostname(url);

      // IP を直接書いた送信先は、名前解決を挟まずそのまま判断する。
      const literal = isIP(hostname);
      if (literal !== 0) {
        if (!isAllowedAddress(hostname, deps.mode)) {
          throw new WebhookTargetError(
            'Webhook 送信先が許可されていないネットワークを指しています',
          );
        }
        return { url, address: hostname, family: literal === 6 ? 6 : 4 };
      }

      let addresses: ResolvedAddress[];
      try {
        addresses = await resolve(hostname);
      } catch {
        throw new WebhookTargetError('Webhook 送信先の名前を解決できません');
      }
      if (addresses.length === 0) {
        throw new WebhookTargetError('Webhook 送信先の名前を解決できません');
      }

      // 一つでも許可されないアドレスがあれば、そのホスト全体を拒む。
      // 安全なものだけ選んで送ると、応答順や実装差で内部側が選ばれる余地が残る。
      for (const candidate of addresses) {
        // 種別が実際のアドレスと食い違う結果は、そのまま接続へ渡さない。
        if (isIP(candidate.address) !== candidate.family) {
          throw new WebhookTargetError('Webhook 送信先の名前解決結果を解釈できません');
        }
        if (!isAllowedAddress(candidate.address, deps.mode)) {
          throw new WebhookTargetError(
            'Webhook 送信先の名前解決結果に許可されていないアドレスが含まれています',
          );
        }
      }

      const [first] = addresses;
      if (first === undefined) {
        throw new WebhookTargetError('Webhook 送信先の名前を解決できません');
      }
      return { url, address: first.address, family: first.family };
    },
  };
}

/** 送信先を登録してよいかを判断する。API から使う。 */
export type WebhookTargetValidator = (rawUrl: string) => Promise<{ canonicalUrl: string }>;

export function createWebhookTargetValidator(policy: WebhookNetworkPolicy): WebhookTargetValidator {
  return async (rawUrl) => ({ canonicalUrl: (await policy.resolve(rawUrl)).url.href });
}
