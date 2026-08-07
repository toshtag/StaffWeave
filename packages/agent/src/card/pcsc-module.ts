/**
 * 装置との受け渡しを、外の部品から読み込む。
 *
 * 既定では、配布物へ同梱している受け渡し（{@link BUNDLED_PCSC_MODULE}）を読む。
 * 別のものを使う端末のために、置き場を渡す道は残してある。
 *
 * 装置のドライバを叩く部分は OS ごとに組み立てが要る。その OS の上で組み立てた
 * ものを、その OS 向けの配布物へ入れてある。端末では取り寄せない。
 *
 * 読み込む相手には 1 つだけを求める。`createPcscTransport` という名前の関数で、
 * {@link PcscTransport} を返すこと。取り決めを 1 つに絞るのは、
 * 相手ごとの分岐を増やさないため。
 */

import type { PcscTransport } from './pcsc.js';

/** 読み込む相手が持っていなければならない形。 */
export const TRANSPORT_FACTORY_NAME = 'createPcscTransport';

/**
 * 同梱している受け渡し。`--pcsc` を省いたときはこれを読む。
 *
 * 配布物の中の場所を指す。外の部品を指すと、配布物だけでは動かない。
 */
export const BUNDLED_PCSC_MODULE = './card/pcsc-winscard.js';

interface TransportModule {
  [TRANSPORT_FACTORY_NAME]?: unknown;
}

function isTransport(value: unknown): value is PcscTransport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PcscTransport>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.waitForCard === 'function' &&
    typeof candidate.transmit === 'function' &&
    typeof candidate.waitForRemoval === 'function' &&
    typeof candidate.reconnect === 'function' &&
    typeof candidate.close === 'function'
  );
}

/**
 * 装置との受け渡しを読み込む。
 *
 * 形が合わない相手は、その場で断る。あとで打刻の途中に落ちると、
 * 何が起きたのかを端末の前の人が判断できない。
 *
 * @param specifier 読み込む相手。モジュール名でも、ファイルの場所でもよい。
 * @param load 読み込みそのもの。テストから差し替えるために開ける。
 */
export async function loadPcscTransport(
  specifier: string,
  load: (specifier: string) => Promise<unknown> = (target) => import(target),
): Promise<PcscTransport> {
  let module: TransportModule;
  try {
    module = (await load(specifier)) as TransportModule;
  } catch (error) {
    throw new Error(
      `装置との受け渡しを読み込めませんでした（${specifier}）: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const factory = module[TRANSPORT_FACTORY_NAME];
  if (typeof factory !== 'function') {
    throw new Error(
      `${specifier} に ${TRANSPORT_FACTORY_NAME} がありません。` +
        `PcscTransport を返す関数を、その名前で公開してください`,
    );
  }

  const transport: unknown = await (factory as () => unknown)();
  if (!isTransport(transport)) {
    throw new Error(
      `${specifier} の ${TRANSPORT_FACTORY_NAME} が返したものは PcscTransport の形ではありません`,
    );
  }
  return transport;
}
