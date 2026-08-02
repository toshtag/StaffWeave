/**
 * API クライアントが接続してよい URL の取り決め。
 *
 * 秘密情報を送る相手の接続先を確かめる。
 *
 * Agent は端末登録トークンと署名付きの打刻を、connector は API キーを送る。
 * どちらも、暗号化されていない接続では中身も資格情報もそのまま観測できる。
 * 署名は改変を見つけるためのもので、秘匿性は与えない。
 *
 * そこで、非ループバックの接続先には HTTPS を必須にする。
 * HTTP は、開発や同一端末での試用として安全にループバックと判定できる相手だけへ許す。
 *
 * 判定は WHATWG の `URL` で正規化してから行う。文字列の見た目で判定すると、
 * `http://2130706433/` のような別表記のループバックを見落とす。
 */

export class InsecureBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureBaseUrlError';
  }
}

/** 正規化した後の IPv4 ループバック（127.0.0.0/8）か。 */
function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false;
  return octets[0] === '127';
}

/**
 * 正規化した後の IPv6 ループバックか。
 *
 * `URL` は `[::ffff:127.0.0.1]` を `[::ffff:7f00:1]` の形へ揃えるため、
 * IPv4 射影の表記もここで拾う。
 */
function isLoopbackIpv6(hostname: string): boolean {
  if (!hostname.startsWith('[') || !hostname.endsWith(']')) return false;
  const address = hostname.slice(1, -1);
  if (address === '::1') return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!mapped) return false;
  // 上位 16 ビットが 0x7f00 なら 127.0.0.0/8。
  return Number.parseInt(mapped[1] ?? '', 16) >>> 8 === 0x7f;
}

/**
 * 暗号化なしで送ってよい相手か。
 *
 * `localhost` は通常ループバックへ解決されるため、開発用途として許す。
 * 名前解決の設定で別の相手を指せる点は、この判定では防げない。
 */
export function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  return isLoopbackIpv4(hostname) || isLoopbackIpv6(hostname);
}

/**
 * 秘密情報を送る接続先として使える形へ整える。
 *
 * 返す値は末尾のスラッシュを落とした正規化済みの文字列。
 * 保存した値を読み直したときにも、同じ関数を通して確かめ直す。
 */
export function requireSecureBaseUrl(rawUrl: string, label = '接続先'): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InsecureBaseUrlError(`${label}の URL を解釈できません`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InsecureBaseUrlError(`${label}には http または https の URL を指定してください`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new InsecureBaseUrlError(`${label}の URL に認証情報を含められません`);
  }
  // 断片は送信されない。書けてしまうと意味のない差異が保存される。
  if (url.hash !== '') {
    throw new InsecureBaseUrlError(`${label}の URL にフラグメントを含められません`);
  }
  if (url.hostname === '') {
    throw new InsecureBaseUrlError(`${label}の URL にホスト名がありません`);
  }
  if (url.port === '0') {
    throw new InsecureBaseUrlError(`${label}の URL のポート番号が不正です`);
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new InsecureBaseUrlError(
      `${label}が暗号化されていません。ループバック以外には https の URL を指定してください`,
    );
  }

  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}
