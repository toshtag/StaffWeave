/**
 * 同時実行を意図して起こすための待ち合わせ。
 *
 * 競合は「両方が同じ行を読み終えたあとで、両方が更新へ進む」ときに起きる。
 * 実時間の待機で順序を作ると、遅い環境では片方が先に終わってしまい、
 * 競合が起きないまま通る。到達した数だけを見て解放し、必ず同じ地点でそろえる。
 */
export interface Barrier {
  /** 全員がここへ到達するまで待ち、そろったところで一斉に進む。 */
  arriveAndWait(): Promise<void>;
}

export function createBarrier(parties: number): Barrier {
  if (parties < 1) throw new Error('待ち合わせる数は 1 以上にしてください');

  let arrived = 0;
  const waiting: (() => void)[] = [];

  return {
    arriveAndWait() {
      arrived += 1;
      if (arrived < parties) {
        return new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      }

      // そろったので待っている側を解放し、次の待ち合わせへ備えて数を戻す。
      arrived = 0;
      for (const resolve of waiting.splice(0)) resolve();
      return Promise.resolve();
    },
  };
}
