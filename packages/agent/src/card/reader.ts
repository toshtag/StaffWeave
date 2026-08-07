import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * IC カードの読み取りアダプター。
 *
 * 実機の読み取り装置は OS ごとに異なるため、このリポジトリには含めない。
 * ここにあるのは「読み取った識別子をどう扱うか」の取り決めと、
 * 実機なしで動きを確かめるためのアダプターだけ。
 *
 * 生の識別子は端末の外へ出さない。サーバーへ送るのは一方向の指紋のみ。
 */

export interface CardReader {
  /**
   * カードが置かれるまで待ち、読み取った識別子を返す。
   *
   * 打ち切りを受け取れる。据え置きの端末は、カードが置かれていない時間のほうが
   * 長い。その待ちを打ち切れないと、止めろと言われてもプロセスが終わらない。
   */
  read(signal?: AbortSignal): Promise<string>;
  readonly name: string;
}

/** 打ち切られたことを表す。呼ぶ側は、これを失敗として扱わない。 */
export class CardReadAborted extends Error {
  constructor() {
    super('読み取りを打ち切りました');
    this.name = 'CardReadAborted';
  }
}

/**
 * カード識別子から指紋を作る。
 *
 * 鍵はサーバーの環境変数に置き、登録時に Agent へ渡す。
 * データベースには指紋しか残らないため、その内容だけでは物理カードと結び付けられない。
 */
export function cardFingerprint(key: string, rawCardId: string): string {
  const normalized = rawCardId.trim().toUpperCase();
  if (normalized.length === 0) {
    throw new Error('カード識別子が空です');
  }
  return createHmac('sha256', key).update(normalized, 'utf8').digest('hex');
}

/** 同じカードかどうかを、指紋どうしの定数時間比較で判定する。 */
export function isSameCard(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 検証用のアダプター。あらかじめ与えた識別子を順に返す。
 * 実機がなくても、登録から打刻までの流れを確かめられる。
 */
export function createScriptedCardReader(cardIds: readonly string[]): CardReader {
  let index = 0;
  return {
    name: 'scripted',
    async read(signal) {
      if (signal?.aborted === true) throw new CardReadAborted();
      const value = cardIds[index];
      if (value === undefined) {
        throw new Error('読み取れるカードがありません');
      }
      index += 1;
      return value;
    },
  };
}
