/**
 * セッションの一覧で端末を見分けるための要約。
 *
 * 一覧に何も手掛かりが無いと、利用者は「どれが自分の PC か」を判断できず、
 * 覚えのないセッションだけを狙って失効させられない。かといって、判別のために
 * 生の User-Agent や送信元アドレスを残すと、セッションが切れた後も
 * 端末と居場所の記録だけが積み上がる。
 *
 * そこで、残すのは次の 3 つだけにする。
 *
 * - OS の系統（`windows`、`macos`、…）
 * - ブラウザの系統（`chrome`、`safari`、…）
 * - 端末の大まかな種別（`desktop`、`mobile`、`tablet`）
 *
 * 版番号は残さない。同じ端末を版で追えるようにする必要がなく、
 * 残せば「いつ更新したか」まで分かってしまう。
 *
 * 表示に使う文字列もここでは決めない。画面の言語ごとに変わるため、
 * 保存するのは機械可読な系統だけにして、訳は画面が持つ。
 */

/** 保存する OS の系統。 */
export const DEVICE_OS_VALUES = [
  'windows',
  'macos',
  'ios',
  'ipados',
  'android',
  'chromeos',
  'linux',
] as const;

/** 保存するブラウザの系統。 */
export const DEVICE_BROWSER_VALUES = [
  'chrome',
  'safari',
  'firefox',
  'edge',
  'opera',
  'samsung',
] as const;

/** 保存する端末の種別。 */
export const DEVICE_KIND_VALUES = ['desktop', 'mobile', 'tablet'] as const;

export type DeviceOs = (typeof DEVICE_OS_VALUES)[number];
export type DeviceBrowser = (typeof DEVICE_BROWSER_VALUES)[number];
export type DeviceKind = (typeof DEVICE_KIND_VALUES)[number];

export interface DeviceSummary {
  os: DeviceOs | null;
  browser: DeviceBrowser | null;
  kind: DeviceKind | null;
}

export function isDeviceOs(value: string): value is DeviceOs {
  return (DEVICE_OS_VALUES as readonly string[]).includes(value);
}

export function isDeviceBrowser(value: string): value is DeviceBrowser {
  return (DEVICE_BROWSER_VALUES as readonly string[]).includes(value);
}

export function isDeviceKind(value: string): value is DeviceKind {
  return (DEVICE_KIND_VALUES as readonly string[]).includes(value);
}

/**
 * 走査する長さの上限。
 *
 * User-Agent は要求元が自由に決められる。長さを見ずに走査すると、
 * 長い頭書きを送るだけでログインの処理時間を伸ばせる。
 * 実在のものは 200 文字前後で収まり、判別に使う語はいずれも前方に現れる。
 */
const SCAN_LIMIT = 512;

function browserOf(ua: string): DeviceBrowser | null {
  // Chrome を名乗る派生が多いため、派生の側から先に見る。
  // 逆にすると、Edge も Opera も Samsung もすべて chrome になる。
  if (ua.includes('Edg/') || ua.includes('EdgiOS/') || ua.includes('EdgA/')) return 'edge';
  if (ua.includes('OPR/') || ua.includes('OPiOS/')) return 'opera';
  if (ua.includes('SamsungBrowser/')) return 'samsung';
  if (ua.includes('Firefox/') || ua.includes('FxiOS/')) return 'firefox';
  if (ua.includes('Chrome/') || ua.includes('CriOS/')) return 'chrome';
  // Safari は Chrome 系も名乗るため、他が外れたときにだけ選ぶ。
  if (ua.includes('Safari/')) return 'safari';
  return null;
}

function osOf(ua: string): DeviceOs | null {
  if (ua.includes('Windows NT')) return 'windows';
  // Android と ChromeOS は Linux も名乗る。狭いほうから先に見る。
  if (ua.includes('Android')) return 'android';
  if (ua.includes('CrOS')) return 'chromeos';
  if (ua.includes('iPad')) return 'ipados';
  if (ua.includes('iPhone') || ua.includes('iPod')) return 'ios';
  if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'macos';
  if (ua.includes('Linux')) return 'linux';
  return null;
}

function kindOf(ua: string, os: DeviceOs | null): DeviceKind | null {
  if (ua.includes('iPad')) return 'tablet';
  if (ua.includes('iPhone') || ua.includes('iPod')) return 'mobile';
  // Android は、板と携帯を `Mobile` の有無で分ける決まりになっている。
  if (os === 'android') return ua.includes('Mobile') ? 'mobile' : 'tablet';
  if (ua.includes('Mobile')) return 'mobile';
  if (os === null) return null;
  return 'desktop';
}

/**
 * User-Agent から、保存する要約を作る。
 *
 * 判別できなければ、その項目だけを null にする。何一つ判別できなければ全体を null にし、
 * 呼び出し側は「端末情報なし」として扱う。ここで例外を投げない。
 * 見慣れない端末から入れなくなる理由が、名乗り方だけになってはいけない。
 *
 * iPadOS の Safari は既定で Macintosh を名乗るため、`macos` の `desktop` になる。
 * 名乗りの上で区別できないものを、こちら側の推測で分けない。
 */
export function summarizeUserAgent(raw: string | null | undefined): DeviceSummary | null {
  if (raw === null || raw === undefined) return null;
  const ua = raw.slice(0, SCAN_LIMIT);
  if (ua.trim() === '') return null;

  const os = osOf(ua);
  const summary: DeviceSummary = { os, browser: browserOf(ua), kind: kindOf(ua, os) };
  if (summary.os === null && summary.browser === null && summary.kind === null) return null;
  return summary;
}
