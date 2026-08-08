/**
 * PC/SC を通した IC カードの読み取り。
 *
 * 対応する標準インターフェースは **PC/SC** の 1 つだけにする。
 * 複数に広げると、どれも実機で確かめないまま増える。
 * PC/SC は Windows（WinSCard）と Linux・macOS（PCSC-Lite）の両方にあり、
 * この製品が想定する据え置きの端末で、いちばん行き渡っている。
 *
 * 装置そのものを叩く部分（ドライバとの受け渡し）はこのリポジトリに含めない。
 * OS ごとに native の部品が要り、同梱すると確かめていない組み合わせを配ることになる。
 * ここが持つのは「読み取った結果をどう扱うか」の取り決めで、
 * 装置との受け渡しは {@link PcscTransport} として外から渡す。
 *
 * 生の識別子は端末の外へ出さない。サーバーへ送るのは一方向の指紋のみ。
 */

import { CardReadAborted, type CardReader } from './reader.js';

/**
 * カードから識別子（UID）を読む APDU。
 *
 * `FF CA 00 00 00` は PC/SC の擬似 APDU で、非接触カードの UID を返す。
 * カードの種類ごとの独自命令は使わない。使うと、装置とカードの組み合わせごとに
 * 分岐が増え、どれも実機で確かめないまま残る。
 */
export const GET_UID_APDU = Uint8Array.from([0xff, 0xca, 0x00, 0x00, 0x00]);

/** 応答の末尾 2 バイト。0x9000 だけが成功。 */
const SUCCESS = 0x9000;

export interface PcscTransport {
  /** 装置の名前。診断へ出す。 */
  readonly name: string;
  /**
   * カードが置かれるまで待つ。
   * 装置が外れている間は待ち続けず、失敗として返して呼ぶ側へ判断を渡す。
   */
  waitForCard(signal?: AbortSignal): Promise<void>;
  /** APDU を送り、応答を受け取る。 */
  transmit(command: Uint8Array): Promise<Uint8Array>;
  /** カードが離れるまで待つ。二重タップの判定に使う。 */
  waitForRemoval(signal?: AbortSignal): Promise<void>;
  /** 装置を開き直す。切断からの復帰で呼ぶ。 */
  reconnect(): Promise<void>;
  close(): Promise<void>;
}

export interface PcscReaderOptions {
  /**
   * 同じカードの連続タップを 1 回として扱う時間（ミリ秒）。
   *
   * 置いたまま離さない、あるいは離してすぐ置き直したときに、
   * 出勤と退勤が続けて記録されるのを防ぐ。
   */
  debounceMs?: number;
  /** 切断から開き直すまでの待ち。試行のたびに広げる。 */
  reconnectDelaysMs?: readonly number[];
  /** 時刻の取得。テストから差し替えるために開ける。 */
  now?: () => number;
  /** 待つ処理。テストから差し替えるために開ける。 */
  sleep?: (milliseconds: number) => Promise<void>;
  /** 診断へ出す記録。秘密は渡さない。 */
  log?: (event: { event: string; detail?: Record<string, unknown> }) => void;
}

export const DEFAULT_DEBOUNCE_MS = 3_000;
/** 開き直しの間隔。広げないと、外れたままの装置へ問い合わせ続けて電源を使い切る。 */
export const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 30_000] as const;

/** 応答から UID を取り出す。取れない応答は理由つきで断る。 */
export function parseUid(response: Uint8Array): string {
  if (response.length < 2) {
    throw new Error('カードの応答が短すぎます');
  }
  const status = (response[response.length - 2] ?? 0) * 256 + (response[response.length - 1] ?? 0);
  if (status !== SUCCESS) {
    // 状態語をそのまま返す。装置ごとの意味づけはここでは行わない。
    throw new Error(`カードを読み取れませんでした（状態語 ${status.toString(16).toUpperCase()}）`);
  }
  const uid = response.subarray(0, response.length - 2);
  if (uid.length === 0) {
    throw new Error('カードが識別子を返しませんでした');
  }
  return [...uid]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * PC/SC の装置から読み取るアダプター。
 *
 * 装置が外れている間は、間を広げながら開き直す。
 * 広げないと、外れたままの装置へ問い合わせ続けることになる。
 */
export function createPcscCardReader(
  transport: PcscTransport,
  options: PcscReaderOptions = {},
): CardReader {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((milliseconds: number) => new Promise((r) => setTimeout(r, milliseconds)));
  const log = options.log ?? (() => {});

  let lastUid: string | null = null;
  let lastReadAt = Number.NEGATIVE_INFINITY;

  return {
    // 受け渡しの名前は、装置が見つかったあとで変わる。1 度きりで写すと、
    // 「待っています」のまま固定され、診断で切り分けられなくなる。
    get name() {
      return `pcsc:${transport.name}`;
    },

    async read(signal?: AbortSignal): Promise<string> {
      let attempt = 0;
      // 関数にしておく。式のまま書くと、一度見た時点で「もう打ち切られていない」
      // と型が決めてしまい、待っている間に立った合図を見なくなる。
      const aborted = (): boolean => signal?.aborted === true;

      for (;;) {
        // 打ち切りは、装置への問い合わせより先に見る。開き直しの待ちから
        // 戻ってきたところで打ち切られていたら、もう装置へは行かない。
        if (aborted()) throw new CardReadAborted();

        try {
          await transport.waitForCard(signal);
          const uid = parseUid(await transport.transmit(GET_UID_APDU));
          attempt = 0;

          // 同じカードが決めた時間内にもう一度読めたら、1 回として扱う。
          // カードが離れるまで待ってから、次の読み取りへ戻る。
          if (uid === lastUid && now() - lastReadAt < debounceMs) {
            log({ event: 'card.debounced' });
            await transport.waitForRemoval(signal);
            continue;
          }

          lastUid = uid;
          lastReadAt = now();
          return uid;
        } catch (error) {
          // 打ち切りは失敗ではない。開き直しの対象にすると、止めろと言われた
          // 装置へ、間を空けながら問い合わせ続けることになる。
          if (error instanceof CardReadAborted) throw error;
          if (aborted()) throw new CardReadAborted();

          // 読み取りの失敗と装置の切断を分けない。どちらも開き直しで復帰する。
          // 分けると、装置ごとに違う失敗の型を並べることになる。
          const delay = delays[Math.min(attempt, delays.length - 1)] ?? 0;
          attempt += 1;
          log({
            event: 'card.reader_reconnecting',
            detail: {
              attempt,
              delayMs: delay,
              // 失敗の理由は残す。カードの識別子は理由に入らない。
              reason: error instanceof Error ? error.message : 'unknown',
            },
          });
          await sleep(delay);
          if (aborted()) throw new CardReadAborted();
          await transport.reconnect();
        }
      }
    },
  };
}
