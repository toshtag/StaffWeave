/**
 * 能力の一覧が指す根拠が、実在することを確かめる。
 *
 * 一覧は「いまの状態」の正本として読まれる。根拠として書いた指し先が
 * 消えても、文書は同じ顔のまま残る。実装を消しても、テストを消しても、
 * 一覧だけは `implemented` と言い続ける。
 *
 * ここで見るのは実在だけで、書いてあることが本当かどうかは見ない。
 * 能力の正しさは、実装と縦に通す検査を見てレビューで判断する。
 * ただし「指し先が無い」ことは機械で分かるため、機械で止める。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const MATRIX = resolve(ROOT, 'docs/product/capability-matrix.md');

const matrix = readFileSync(MATRIX, 'utf8');

/** `` `種類:値` `` の形で書かれた根拠。 */
function evidence(kind: string): string[] {
  return [...matrix.matchAll(new RegExp(`\`${kind}:([^\`]+)\``, 'g'))].map(
    (match) => match[1] as string,
  );
}

describe('能力の一覧の根拠', () => {
  it('test / ui / script / migration の指し先が実在する', () => {
    const missing = ['test', 'ui', 'script', 'migration', 'e2e', 'docs']
      .flatMap((kind) =>
        evidence(kind).map((value) => ({
          kind,
          // migration は versions のディレクトリからの相対、docs は docs/ からの相対で書く。
          path:
            kind === 'migration'
              ? `packages/db/migrations/${value}`
              : kind === 'docs'
                ? `docs/${value}`
                : value,
        })),
      )
      .filter((entry) => !existsSync(resolve(ROOT, entry.path)))
      .map((entry) => `${entry.kind}:${entry.path}`);

    expect(missing).toEqual([]);
  });

  it('op の指し先が API の契約に実在する', () => {
    const operations = readFileSync(resolve(ROOT, 'packages/contracts/src/operations.ts'), 'utf8');
    const missing = evidence('op').filter((name) => !operations.includes(`operationId: '${name}'`));

    expect(missing).toEqual([]);
  });

  /**
   * 状態は 4 つだけ。増やすと、読む人が「どちらに近いのか」を毎回考えることになる。
   */
  it('状態は決めた 4 つだけを使う', () => {
    const states = [...matrix.matchAll(/^\| [^|]+ \| ([a-z-]+) \|/gm)].map(
      (match) => match[1] as string,
    );
    const unknown = [...new Set(states)]
      // 表の区切り行（`| --- | --- |`）は状態ではない。
      .filter((state) => state !== '---')
      .filter((state) => !['implemented', 'partial', 'planned', 'non-goal'].includes(state));

    expect(unknown).toEqual([]);
  });
});
