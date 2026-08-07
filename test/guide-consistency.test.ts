/**
 * 利用ガイドが、能力の一覧と逆のことを断定していないか。
 *
 * 能力の一覧は「いまの状態」の正本として直し続けている。利用ガイドは、
 * 作った当時の状態のまま残りやすい。実際に、Webhook の自動再送を実装したあとも
 * 「自動再送しません」「今後の課題です」と書いたままだった。読む人は使い方を
 * ガイドで読むため、正本だけを直しても、間違いはそのまま届く。
 *
 * ここで見るのは 1 種類だけ。「一覧が implemented と書いている能力について、
 * ガイドが無いと断定していないか」。文書の言い回しを網羅する検査は置かない。
 * 網羅しようとすると、文章を直すたびに検査を直すことになり、割に合わない。
 *
 * 対になる語は下の表に手で並べる。増やすのは、実際に食い違った箇所が出たとき。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const matrix = read('docs/product/capability-matrix.md');

/** その能力が `implemented` として一覧に並んでいるか。 */
function isImplemented(capability: string): boolean {
  return matrix
    .split('\n')
    .some((line) => line.startsWith(`| ${capability} |`) && line.includes('| implemented |'));
}

/**
 * 一覧の能力と、それを否定するガイドの言い回しの対。
 *
 * 言い回しは、実際にその文書へ書かれていたものを使う。似た言い方まで広げると、
 * 普通の文章が引っかかり、検査を黙らせるために文章のほうを歪めることになる。
 */
const PAIRS: readonly { capability: string; guide: string; denial: string }[] = [
  {
    capability: 'Webhook の自動再送とデッドレター',
    guide: 'docs/guide/integrations.md',
    denial: '自動再送しません',
  },
  {
    capability: 'Webhook の自動再送とデッドレター',
    guide: 'docs/guide/integrations.md',
    denial: '再送とデッドレター管理は今後の課題',
  },
  {
    capability: '勤務周期による予定の生成',
    guide: 'docs/guide/features.md',
    denial: '勤務周期・契約',
  },
];

describe('利用ガイドと能力の一覧', () => {
  it('一覧が implemented と書く能力を、ガイドが無いと断定しない', () => {
    const contradictions = PAIRS.filter(
      (pair) => isImplemented(pair.capability) && read(pair.guide).includes(pair.denial),
    ).map((pair) => `${pair.guide}: ${pair.capability} を「${pair.denial}」と書いている`);

    expect(contradictions).toEqual([]);
  });

  /**
   * 対の左側が、一覧に実在すること。
   *
   * 能力の名前を変えたときに、この検査だけが何も見ないまま通り続けるのを防ぐ。
   * 見ていない検査は、置いていないのと同じになる。
   */
  it('対にした能力が、一覧に実在する', () => {
    const missing = [...new Set(PAIRS.map((pair) => pair.capability))].filter(
      (capability) => !matrix.includes(`| ${capability} |`),
    );

    expect(missing).toEqual([]);
  });
});
