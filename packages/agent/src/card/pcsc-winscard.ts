/**
 * Windows と PCSC-Lite の読み取り装置へつなぐ、同梱の受け渡し。
 *
 * これまで配布物には具体的な受け渡しが無く、`createPcscTransport` を利用者が
 * 自分で書く前提だった。据え置き端末を置く人に TypeScript を書かせるのは、
 * 「配布物だけで動く」とは言えない。ここが、その 1 つを引き受ける。
 *
 * 装置のドライバを直接叩く部分は、`pcsclite` という他所の部品が持つ。
 * これは OS ごとに組み立てが要るため、リポジトリには入れない。配布物には、
 * その OS の上で組み立てたものを入れてある（Windows 向けの配布物）。
 * 端末では取り寄せない。現場の端末は通信できないことがあり、組み立ての道具も無い。
 *
 * ここが引き受けるのは、その部品の呼び出し方を 1 つに決めることと、
 * 入っていないときに何をすればよいかを、その場で言うこと。
 */

import type { PcscTransport } from './pcsc.js';
import { CardReadAborted } from './reader.js';

/** 端末で取り寄せる部品の名前。手順書と検査の両方から参照する。 */
export const READER_MODULE = 'pcsclite';

/** 入っていないときに出す案内。何をすればよいかまで書く。 */
export const READER_MISSING_MESSAGE =
  `読み取り装置の部品（${READER_MODULE}）が配布物に入っていません。` +
  '読み取り装置を使う端末には、その OS 向けの配布物' +
  '（staffweave-agent-windows-x64-<版>.zip）を置いてください';

/** `pcsclite` が返す装置。使う分だけを写す。 */
interface PcscLiteReader {
  name: string;
  SCARD_SHARE_SHARED: number;
  SCARD_STATE_PRESENT: number;
  SCARD_PROTOCOL_T0: number;
  SCARD_PROTOCOL_T1: number;
  SCARD_LEAVE_CARD: number;
  connect(
    options: { share_mode: number },
    callback: (error: Error | null, protocol: number) => void,
  ): void;
  disconnect(disposition: number, callback: (error: Error | null) => void): void;
  transmit(
    input: Buffer,
    responseLength: number,
    protocol: number,
    callback: (error: Error | null, output: Buffer) => void,
  ): void;
  on(event: 'status', listener: (status: { state: number }) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'end', listener: () => void): void;
  off(event: 'status', listener: (status: { state: number }) => void): void;
  off(event: 'error', listener: (error: Error) => void): void;
  off(event: 'end', listener: () => void): void;
  close(): void;
}

interface PcscLite {
  on(event: 'reader', listener: (reader: PcscLiteReader) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  off(event: 'reader', listener: (reader: PcscLiteReader) => void): void;
  off(event: 'error', listener: (error: Error) => void): void;
  close(): void;
}

/** 装置が外れた、あるいは直せない失敗を起こしたことを表す。 */
export class ReaderGone extends Error {
  constructor(reason: string) {
    super(`読み取り装置が使えなくなりました: ${reason}`);
    this.name = 'ReaderGone';
  }
}

type PcscLiteFactory = () => PcscLite;

/** 応答の上限。UID を返す擬似 APDU には十分で、装置の実装差も吸収できる。 */
const RESPONSE_LENGTH = 258;

/** 装置が現れるまで待つ上限。越えたら、待ち続けずに呼ぶ側へ返す。 */
const READER_WAIT_MS = 30_000;

async function loadPcscLite(
  load: (specifier: string) => Promise<unknown>,
): Promise<PcscLiteFactory> {
  let module: unknown;
  try {
    module = await load(READER_MODULE);
  } catch {
    // 取り寄せていないことと、壊れていることを分けない。どちらも
    // 「入れ直してください」で直る。分けると案内が増えるだけになる。
    throw new Error(READER_MISSING_MESSAGE);
  }
  const factory = (module as { default?: unknown }).default ?? module;
  if (typeof factory !== 'function') {
    throw new Error(`${READER_MODULE} の形が想定と違います。入れ直してください`);
  }
  return factory as PcscLiteFactory;
}

/**
 * 装置が 1 つ現れるまで待つ。
 *
 * 複数刺さっている場合は、最初に現れたものを使う。選ばせる仕組みは置かない。
 * 据え置きの端末に読み取り装置を 2 つ付ける運用は想定していない。
 *
 * 待ち受けは、決まったときにも時間切れにも打ち切りにも外す。外さないと、
 * 抜き差しのたびに 1 つずつ溜まる。抜き差しは何度も起こる。
 */
function nextReader(
  pcsc: PcscLite,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PcscLiteReader> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void): void => {
      clearTimeout(timer);
      pcsc.off('reader', onReader);
      pcsc.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const onReader = (reader: PcscLiteReader): void => settle(() => resolve(reader));
    const onError = (error: Error): void => settle(() => reject(error));
    const onAbort = (): void => settle(() => reject(new CardReadAborted()));
    const timer = setTimeout(() => {
      settle(() => reject(new Error('読み取り装置が見つかりません。接続を確かめてください')));
    }, timeoutMs);
    timer.unref?.();

    if (signal?.aborted === true) {
      settle(() => reject(new CardReadAborted()));
      return;
    }
    pcsc.on('reader', onReader);
    pcsc.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * カードが置かれた／離れた、のどちらかになるまで待つ。
 *
 * 待ち受けは、決まったときにも打ち切られたときにも必ず外す。外さないと、
 * タップと離脱のたびに 1 つずつ溜まる。据え置きの端末は何か月も動き続けるため、
 * 溜まったぶんだけ記憶を使い、やがて警告が出るようになる。
 */
function waitForState(
  reader: PcscLiteReader,
  present: boolean,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void): void => {
      reader.off('status', onStatus);
      reader.off('end', onEnd);
      reader.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const onStatus = (status: { state: number }): void => {
      const isPresent = (status.state & reader.SCARD_STATE_PRESENT) !== 0;
      if (isPresent === present) settle(resolve);
    };
    // 装置が抜かれると、状態は二度と来ない。end を見ていないと、
    // ここで待ち続けたまま固まり、開き直しの輪へも戻れない。
    const onEnd = (): void => settle(() => reject(new ReaderGone('取り外されました')));
    const onError = (error: Error): void => settle(() => reject(new ReaderGone(error.message)));
    const onAbort = (): void => settle(() => reject(new CardReadAborted()));

    if (signal?.aborted === true) {
      reject(new CardReadAborted());
      return;
    }
    reader.on('status', onStatus);
    reader.on('end', onEnd);
    reader.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 同梱の受け渡しを作る。
 *
 * `loadPcscTransport` から名前で呼ばれる形（`createPcscTransport`）に合わせてある。
 * `--pcsc` を省いたときの既定として、Agent がこれを読み込む。
 *
 * 装置は抱え込まない。抜かれたら捨てて、次に現れたものへ差し替える。抱え込むと、
 * 一度抜いた時点で終わりになる。差し直しても、死んだ装置へつなぎ直そうとする。
 * 据え置きの端末で装置が抜かれるのは、事故ではなく普通に起こることとして扱う。
 *
 * 装置が 1 台も無くても作れる。作る時点で待つと、端末の起動時に装置がまだ
 * 見えていないだけで常駐そのものが終わる。認識が遅い、あとから挿す、USB の口の
 * 初期化が遅れる、はどれも普通に起こる。装置を待つのは `waitForCard` の側。
 *
 * @param load 部品の読み込み。検査から差し替えるために開ける。
 * @param timeoutMs 装置が現れるのを、1 回にどれだけ待つか。ここを越えても
 *   終わりにはしない。待ちを区切るだけで、呼ぶ側が待ち直す。
 */
export async function createPcscTransport(
  load: (specifier: string) => Promise<unknown> = (target) => import(target),
  timeoutMs: number = READER_WAIT_MS,
): Promise<PcscTransport> {
  const factory = await loadPcscLite(load);
  const pcsc = factory();

  /** いま使っている装置。まだ無い、あるいは抜かれた間は null。 */
  let reader: PcscLiteReader | null = null;
  let protocol = 0;
  /** 一度でも装置を見たか。診断に出す名前を決めるために持つ。 */
  let seen: string | null = null;

  /** 装置を確保する。抜けていれば、次に現れるまで待つ。 */
  const require = async (signal?: AbortSignal): Promise<PcscLiteReader> => {
    if (reader !== null) return reader;
    reader = await nextReader(pcsc, timeoutMs, signal);
    protocol = 0;
    seen = reader.name;
    return reader;
  };

  /** 抜けたことにする。次の確保で新しいものを待つ。 */
  const forget = (): void => {
    reader = null;
    protocol = 0;
  };

  const connect = (target: PcscLiteReader): Promise<void> =>
    new Promise((resolve, reject) => {
      target.connect({ share_mode: target.SCARD_SHARE_SHARED }, (error, negotiated) => {
        if (error) reject(error);
        else {
          protocol = negotiated;
          resolve();
        }
      });
    });

  /**
   * 装置を使う 1 回ぶん。
   *
   * 装置が使えなくなったら、抱えているものを捨てる。捨てないと、次も同じ
   * 死んだ装置を使い、抜き差ししても戻らない。
   */
  const using = async <T>(
    signal: AbortSignal | undefined,
    work: (target: PcscLiteReader) => Promise<T>,
  ): Promise<T> => {
    const target = await require(signal);
    try {
      return await work(target);
    } catch (error) {
      if (error instanceof ReaderGone) forget();
      throw error;
    }
  };

  return {
    // まだ見つけていない間は、そのことが分かる名前にする。診断へ出るのは
    // この値で、装置が無いのか読めないのかを、そこで切り分けられる。
    get name() {
      return seen ?? '（読み取り装置を待っています）';
    },

    waitForCard(signal) {
      return using(signal, async (target) => {
        await waitForState(target, true, signal);
        await connect(target);
      });
    },

    transmit(command) {
      return new Promise((resolve, reject) => {
        if (reader === null) {
          reject(new ReaderGone('取り外されています'));
          return;
        }
        reader.transmit(Buffer.from(command), RESPONSE_LENGTH, protocol, (error, output) => {
          if (error) reject(error);
          else resolve(Uint8Array.from(output));
        });
      });
    },

    waitForRemoval(signal) {
      return using(signal, (target) => waitForState(target, false, signal));
    },

    async reconnect() {
      // 抜けているなら、開き直す相手が居ない。次の確保で新しいものを待つ。
      if (reader === null) return;
      // 切り離してから開き直す。開いたまま重ねると、装置が掴まれたままになる。
      const target = reader;
      await new Promise<void>((resolve) => {
        target.disconnect(target.SCARD_LEAVE_CARD, () => resolve());
      });
      await connect(target).catch(() => {
        // 開き直せない装置は捨てる。次の確保で新しいものを待つ。
        forget();
      });
    },

    async close() {
      reader?.close();
      pcsc.close();
    },
  };
}
