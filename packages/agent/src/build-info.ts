import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 配布物の版と、元にした commit。
 *
 * 配布物を組むときに、この隣へ 1 つのファイルとして置く（`scripts/package-agent.sh`）。
 * 利用者へ直接渡るのは Agent 本体なので、そこが版を持たないと、診断・保守・
 * 問い合わせで「どの版か」を辿れない。
 *
 * `package.json` を読まないのは、取り寄せの都合で書き換わったものを版として
 * 出しかねないため。読むのは、組むときに書いたこのファイルだけにする。
 *
 * 秘密は入れない。診断は保守の人が現場で実行し、画面と端末の履歴に残る。
 */
export interface BuildInfo {
  version: string;
  /** 元にした commit。取れない場所で組んだときは空。 */
  sourceSha: string;
  /**
   * 対応する Node の主版。
   *
   * 読み取り装置の部品は組み立てが要り、Node の版ごとの ABI に合わせて作られる。
   * 別の版で動かすと、読み込みの時点で落ちる。落ちてから理由を探すより、
   * 先に言ったほうがよい。
   */
  nodeMajor: string;
  /** 同梱している読み取り装置の部品。入っていなければ空。 */
  reader: string;
}

/** リポジトリから直接動かしているときの値。配布物ではない、と分かる形にする。 */
export const UNPACKAGED: BuildInfo = {
  version: '（配布物ではありません）',
  sourceSha: '',
  nodeMajor: '',
  reader: '',
};

export async function loadBuildInfo(
  directory: string = dirname(fileURLToPath(import.meta.url)),
): Promise<BuildInfo> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return UNPACKAGED;
    const record = parsed as Record<string, unknown>;
    if (typeof record.version !== 'string') return UNPACKAGED;
    return {
      version: record.version,
      sourceSha: typeof record.sourceSha === 'string' ? record.sourceSha : '',
      nodeMajor: typeof record.nodeMajor === 'string' ? record.nodeMajor : '',
      reader: typeof record.reader === 'string' ? record.reader : '',
    };
  } catch {
    // 無いこと自体は失敗ではない。リポジトリから動かしているときは置かれていない。
    return UNPACKAGED;
  }
}
