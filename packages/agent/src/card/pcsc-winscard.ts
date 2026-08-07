/**
 * Windows と PCSC-Lite の読み取り装置へつなぐ、同梱の受け渡し。
 *
 * これまで配布物には具体的な受け渡しが無く、`createPcscTransport` を利用者が
 * 自分で書く前提だった。据え置き端末を置く人に TypeScript を書かせるのは、
 * 「配布物だけで動く」とは言えない。ここが、その 1 つを引き受ける。
 *
 * 装置のドライバを直接叩く部分は、`pcsclite` という他所の部品が持つ。
 * これは OS ごとに組み立てが要るため、リポジトリにも配布物にも入れない。
 * 組み立て済みのものを Linux で作って Windows へ配ることはできないため、
 * 端末の側で取り寄せる（配布物の `install-reader.ps1`）。
 *
 * ここが引き受けるのは、その部品の呼び出し方を 1 つに決めることと、
 * 入っていないときに何をすればよいかを、その場で言うこと。
 */

import type { PcscTransport } from './pcsc.js';

/** 端末で取り寄せる部品の名前。手順書と検査の両方から参照する。 */
export const READER_MODULE = 'pcsclite';

/** 取り寄せていないときに出す案内。何をすればよいかまで書く。 */
export const READER_MISSING_MESSAGE =
  `読み取り装置の部品（${READER_MODULE}）がこの端末にありません。` +
  '配布物の install-reader.ps1 を管理者として実行してから、もう一度試してください';

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
  close(): void;
}

interface PcscLite {
  on(event: 'reader', listener: (reader: PcscLiteReader) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  close(): void;
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
 */
function firstReader(pcsc: PcscLite, timeoutMs: number): Promise<PcscLiteReader> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('読み取り装置が見つかりません。接続を確かめてください'));
    }, timeoutMs);
    timer.unref?.();

    pcsc.on('reader', (reader) => {
      clearTimeout(timer);
      resolve(reader);
    });
    pcsc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** カードが置かれた／離れた、のどちらかになるまで待つ。 */
function waitForState(reader: PcscLiteReader, present: boolean): Promise<void> {
  return new Promise((resolve) => {
    const listener = (status: { state: number }): void => {
      const isPresent = (status.state & reader.SCARD_STATE_PRESENT) !== 0;
      if (isPresent === present) resolve();
    };
    reader.on('status', listener);
  });
}

/**
 * 同梱の受け渡しを作る。
 *
 * `loadPcscTransport` から名前で呼ばれる形（`createPcscTransport`）に合わせてある。
 * `--pcsc` を省いたときの既定として、Agent がこれを読み込む。
 *
 * @param load 部品の読み込み。検査から差し替えるために開ける。
 */
export async function createPcscTransport(
  load: (specifier: string) => Promise<unknown> = (target) => import(target),
  timeoutMs: number = READER_WAIT_MS,
): Promise<PcscTransport> {
  const factory = await loadPcscLite(load);
  const pcsc = factory();
  const reader = await firstReader(pcsc, timeoutMs);
  let protocol = 0;

  const connect = (): Promise<void> =>
    new Promise((resolve, reject) => {
      reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (error, negotiated) => {
        if (error) reject(error);
        else {
          protocol = negotiated;
          resolve();
        }
      });
    });

  return {
    name: reader.name,

    async waitForCard() {
      await waitForState(reader, true);
      await connect();
    },

    transmit(command) {
      return new Promise((resolve, reject) => {
        reader.transmit(Buffer.from(command), RESPONSE_LENGTH, protocol, (error, output) => {
          if (error) reject(error);
          else resolve(Uint8Array.from(output));
        });
      });
    },

    waitForRemoval() {
      return waitForState(reader, false);
    },

    async reconnect() {
      // 切り離してから開き直す。開いたまま重ねると、装置が掴まれたままになる。
      await new Promise<void>((resolve) => {
        reader.disconnect(reader.SCARD_LEAVE_CARD, () => resolve());
      });
      await connect();
    },

    async close() {
      reader.close();
      pcsc.close();
    },
  };
}
