import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 行儀よく止めるための合図。
 *
 * Unix なら SIGTERM で足りますが、Windows には「行儀よく終われ」という合図が
 * ありません。タスクスケジューラの停止も、サービスの停止も、プロセスを
 * 強制的に終わらせるだけです（[0002](../../../../docs/decisions/0002-windows-residency.md)）。
 * 送信の途中で強制的に終わらせても送信待ちは消えませんが、毎回そうする理由もありません。
 *
 * そこで、合図をファイルとして置きます。常駐している側は周回のたびに見て、
 * 置かれていたら今の 1 件を送り終えてから終わります。どの環境でも同じ仕組みで
 * 止められるので、Windows のためだけの経路を作らずに済みます。
 *
 * 中身は見ません。あるかどうかだけを見ます。中身を約束すると、書く側と読む側で
 * 形を合わせ続けることになり、合図としては重すぎます。
 */

/** 合図の置き場。送信待ちの隣に置く。 */
export function stopSignalPath(spoolPath: string): string {
  return `${spoolPath}.stop`;
}

/** 合図を置く。すでにあれば、そのままにする。 */
export async function requestStop(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '', { mode: 0o600 });
}

/** 合図が置かれているか。 */
export async function isStopRequested(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 合図を片付ける。
 *
 * 終わるときに消します。残したまま次に上げると、上がった直後に止まります。
 * 消せなくても失敗にしません。消せない置き場に合図が残っていても、
 * 打刻を送ること自体は続けられます。
 */
export async function clearStop(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {});
}
