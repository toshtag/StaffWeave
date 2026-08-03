/**
 * Webhook 送信先の検査。
 *
 * URL の構文、名前解決、接続先アドレスの分類をここへまとめる。
 * 登録時と送信時の両方から同じ判断を通し、二つの経路で基準がずれないようにする。
 *
 * 判定は「接続してよいアドレスか」だけを見る。宛先が実在するかは確かめない。
 * 分類には Node.js 標準の `net.BlockList` を使い、外部の IP 解析ライブラリは足さない。
 */

import { Resolver } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { MAXIMUM_WEBHOOK_URL_LENGTH, MINIMUM_WEBHOOK_URL_LENGTH } from '@staffweave/domain';

/** 送信先として許すネットワークの範囲。 */
export type WebhookNetworkPolicyMode = 'public-only' | 'allow-local';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * ホスト名から接続先候補を得る。テストから差し替えられるようにする。
 *
 * 中断信号を受け取り、上限時間を過ぎた解決を打ち切れるようにする。
 * 打ち切れないと、遅い送信先を並べるだけで API の応答を滞留させられる。
 */
export type WebhookHostResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<ResolvedAddress[]>;

/**
 * 検査を通った送信先。HTTP はこの候補のいずれかへ接続する。
 *
 * 候補を 1 件へ絞らない。全件が検査済みであれば、どれへつないでも安全であり、
 * IPv6 の経路が無い環境で IPv4 の候補を試せなくなる方が実害が大きい。
 */
export interface ResolvedWebhookTarget {
  url: URL;
  addresses: readonly ResolvedAddress[];
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
 * 送信先として絶対に許さない範囲。`allow-local` でも上書きできない。
 *
 * 内部サービスへ送りたいという要求と、これらへ到達できることは関係がない。
 * 許しても、クラウドの資格情報や到達しない宛先を晒す危険だけが増える。
 *
 * 範囲は次のレジストリを基準にした（確認日: 2026-07-31）。
 * 実行時に取得はせず、変更があれば別 Issue で一覧とテストを更新する。
 *
 * - IANA IPv4 Special-Purpose Address Registry
 * - IANA IPv6 Special-Purpose Address Registry
 * - IANA IPv6 Global Unicast Address Assignments
 */
const ALWAYS_DENIED_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // 未指定
  ['100.64.0.0', 10], // Carrier-grade NAT
  ['169.254.0.0', 16], // リンクローカル（メタデータサービスを含む）
  ['192.0.0.0', 24], // IETF プロトコル割り当て
  ['192.0.2.0', 24], // 文書用 TEST-NET-1
  ['192.88.99.0', 24], // 6to4 リレーの anycast（廃止）
  ['198.18.0.0', 15], // ベンチマーク用
  ['198.51.100.0', 24], // 文書用 TEST-NET-2
  ['203.0.113.0', 24], // 文書用 TEST-NET-3
  ['224.0.0.0', 4], // マルチキャスト
  ['240.0.0.0', 4], // 予約済み（255.255.255.255 を含む）
  // 公開空間にありながら、基盤側の内部通信に割り当てられている仮想アドレス。
  ['168.63.129.16', 32], // 既知のプラットフォーム内部仮想アドレス
];

const ALWAYS_DENIED_IPV6: readonly (readonly [string, number])[] = [
  ['::', 128], // 未指定
  ['::ffff:0:0', 96], // IPv4 射影
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // NAT64 ローカル
  ['100::', 64], // 破棄用
  ['2001::', 23], // IETF プロトコル割り当て（Teredo・ベンチマーク・ORCHID など）
  ['2001:db8::', 32], // 文書用
  ['2002::', 16], // 6to4
  ['3fff::', 20], // 文書用（RFC 9637）
  ['fe80::', 10], // リンクローカル
  ['fec0::', 10], // サイトローカル（廃止）
  ['ff00::', 8], // マルチキャスト
  // ユニークローカルの中にある既知のメタデータエンドポイント。
  // fc00::/7 全体を常時拒否にはしない。それでは内部サービスへ送れなくなる。
  ['fd00:ec2::254', 128], // 既知の IPv6 メタデータエンドポイント
  ['fd20:ce::254', 128], // 既知の IPv6 メタデータエンドポイント
];
// IPv4 互換（`::a.b.c.d`、廃止）はここへ入れない。`::/96` は `::1` を含むため、
// 常時拒否にするとループバックまで `allow-local` で使えなくなる。
// これらは 2000::/3 の外にあり、下のグローバルユニキャスト判定で除かれる。

/**
 * `allow-local` でのみ許す範囲。
 *
 * 常時拒否の判定を先に行うため、この範囲に入っていても
 * `fd00:ec2::254` のような常時拒否の宛先は許可されない。
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
 * 現在割り当てられている IPv6 のグローバルユニキャスト空間。
 *
 * IPv6 は「拒否一覧に無いから公開」とは判断しない。特別用途の範囲は後から増えるため、
 * 拒否一覧だけを頼りにすると、新しい範囲が追加されるたびに穴ができる。
 * まずこの範囲に入っていることを求め、その中の特別用途を常時拒否で除く。
 */
const GLOBAL_UNICAST_IPV6: readonly (readonly [string, number])[] = [['2000::', 3]];

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

const isAlwaysDenied = matcherOf(ALWAYS_DENIED_IPV4, ALWAYS_DENIED_IPV6);
const isLocal = matcherOf(LOCAL_IPV4, LOCAL_IPV6);
const isGlobalUnicastIpv6 = matcherOf([], GLOBAL_UNICAST_IPV6);

/**
 * ローカルとして扱うアドレスか。
 *
 * `allow-local` のときだけ許す範囲であり、暗号化なしで送ってよい範囲でもある。
 */
export function isLocalAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  const family = version === 4 ? 4 : 6;
  if (isAlwaysDenied(address, family)) return false;
  return isLocal(address, family);
}

/**
 * そのアドレスへ接続してよいか。
 *
 * 判定の順序に意味がある。常時拒否をローカル許可より先に見ることで、
 * `allow-local` が常時拒否の宛先を上書きできないようにする。
 */
export function isAllowedAddress(
  address: string,
  mode: WebhookNetworkPolicyMode = 'public-only',
): boolean {
  const version = isIP(address);
  if (version === 0) return false;

  const family = version === 4 ? 4 : 6;
  if (isAlwaysDenied(address, family)) return false;
  if (isLocal(address, family)) return mode === 'allow-local';
  // IPv4 はここまでで私設・特別用途を除いてある。IPv6 は割り当て済みの範囲を要求する。
  return family === 4 || isGlobalUnicastIpv6(address, 6);
}

/** 長さの理由。URL 全体は含めない。長い入力をそのまま返しても読めない。 */
function tooLong(): WebhookTargetError {
  return new WebhookTargetError(
    `Webhook 送信先の URL は ${MINIMUM_WEBHOOK_URL_LENGTH} 文字以上 ` +
      `${MAXIMUM_WEBHOOK_URL_LENGTH} 文字以内で指定してください`,
  );
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
  if (rawUrl.length < MINIMUM_WEBHOOK_URL_LENGTH || rawUrl.length > MAXIMUM_WEBHOOK_URL_LENGTH) {
    throw tooLong();
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookTargetError('Webhook 送信先の URL を解釈できません');
  }

  // 保存も送信も正規化後の URL で行う。入力が上限内でも、percent encoding で
  // 増えた結果が上限を超えることがある。
  if (url.href.length > MAXIMUM_WEBHOOK_URL_LENGTH) {
    throw tooLong();
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

/**
 * 暗号化なしで送ってよい相手かを確かめる。
 *
 * 送信先の登録は利用者が行い、本文には勤怠や申請の内容が入る。
 * 署名は改変を見つけるためのもので、本文と署名の秘匿性は与えない。
 *
 * `allow-local` で明示的に許したローカル宛だけ `http` を通す。
 * 公開ネットワーク宛は、設定に関わらず `https` を必須にする。
 */
function requireEncryptedForPublicTarget(url: URL, addresses: ResolvedAddress[]): void {
  if (url.protocol === 'https:') return;
  if (addresses.every((candidate) => isLocalAddress(candidate.address))) return;
  throw new WebhookTargetError(
    '公開ネットワーク宛の Webhook 送信先には https の URL を指定してください',
  );
}

export interface WebhookNetworkPolicy {
  /** URL を検査し、名前解決した全アドレスを確かめて、接続先の候補を決める。 */
  resolve(rawUrl: string, signal?: AbortSignal): Promise<ResolvedWebhookTarget>;
}

export interface WebhookNetworkPolicyDependencies {
  mode: WebhookNetworkPolicyMode;
  resolver?: WebhookHostResolver;
}

/**
 * 既定の名前解決。
 *
 * `dns.lookup()` は使わない。OS の `getaddrinfo()` を固定数のスレッドで動かすため
 * 打ち切れず、遅い解決が溜まると同じプロセスの他の処理まで巻き込む。
 * `Resolver` なら中断でき、問い合わせもイベントループ側で行われる。
 *
 * 代償として `hosts` ファイルだけにある別名は解決できない。ローカル宛の送信先は
 * DNS で解決できる名前か IP リテラルで指定する。
 * docs/security/webhook-target-policy.md に記載している。
 */
const defaultResolver: WebhookHostResolver = async (hostname, signal) => {
  const resolver = new Resolver();
  const cancel = (): void => resolver.cancel();
  if (signal.aborted) cancel();
  signal.addEventListener('abort', cancel, { once: true });

  try {
    // 片方の種別にレコードが無くても、他方が引けていれば送信先として使える。
    const [ipv4, ipv6] = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    if (ipv4.status === 'rejected' && ipv6.status === 'rejected') throw ipv4.reason;

    // IPv4 を先に並べる。セルフホストでは IPv6 の経路が無いことが珍しくなく、
    // 先頭から試す実装で無駄な待ちを作らないため。
    return dedupeAddresses([
      ...(ipv4.status === 'fulfilled'
        ? ipv4.value.map((address) => ({ address, family: 4 as const }))
        : []),
      ...(ipv6.status === 'fulfilled'
        ? ipv6.value.map((address) => ({ address, family: 6 as const }))
        : []),
    ]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
};

/** 同じアドレスを繰り返し試さない。順序は入力のまま保つ。 */
function dedupeAddresses(addresses: readonly ResolvedAddress[]): ResolvedAddress[] {
  const seen = new Set<string>();
  return addresses.filter((candidate) => {
    const key = `${candidate.family}:${candidate.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 中断されない信号。呼び出し側が上限時間を持たない場合に使う。 */
const NEVER_ABORTED = new AbortController().signal;

export function createWebhookNetworkPolicy(
  deps: WebhookNetworkPolicyDependencies,
): WebhookNetworkPolicy {
  const resolve = deps.resolver ?? defaultResolver;

  return {
    async resolve(rawUrl, signal) {
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
        const addresses: ResolvedAddress[] = [{ address: hostname, family: literal === 6 ? 6 : 4 }];
        requireEncryptedForPublicTarget(url, addresses);
        return { url, addresses };
      }

      let addresses: ResolvedAddress[];
      try {
        addresses = dedupeAddresses(await resolve(hostname, signal ?? NEVER_ABORTED));
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

      requireEncryptedForPublicTarget(url, addresses);

      // 検査を通った候補はすべて残す。接続側が到達できるものを選べるようにする。
      return { url, addresses };
    },
  };
}

/** 送信先を登録してよいかを判断する。API から使う。 */
export type WebhookTargetValidator = (rawUrl: string) => Promise<{ canonicalUrl: string }>;

export interface WebhookTargetValidatorOptions {
  /**
   * 登録の検査を打ち切るまでの時間。
   *
   * 登録の応答はこの検査を待つ。上限が無いと、解決に時間のかかる送信先を並べるだけで
   * API の応答を滞留させられる。ワーカー側は送信全体の上限時間を使う。
   */
  timeoutMs: number;
}

export function createWebhookTargetValidator(
  policy: WebhookNetworkPolicy,
  options: WebhookTargetValidatorOptions,
): WebhookTargetValidator {
  return async (rawUrl) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 打ち切りは中断信号だけに任せない。信号を見ない解決器を渡されても上限を守るため。
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new WebhookTargetError('Webhook 送信先を制限時間内に確認できませんでした'));
      }, options.timeoutMs);
    });

    const checked = policy
      .resolve(rawUrl, controller.signal)
      .then((target) => ({ canonicalUrl: target.url.href }));

    try {
      return await Promise.race([checked, expired]);
    } finally {
      clearTimeout(timer);
    }
  };
}
