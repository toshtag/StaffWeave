/**
 * 消し忘れても誰も気付かない文言を止める。
 *
 * どこからも参照されない文言と、実装済みの機能を未実装と告げる文言の 2 つを見る。
 * どちらも、間違っていても画面が壊れないため、放っておくと積み上がる。
 *
 * 使われなくなった文言は、型検査を通り、画面にも現れない。消し忘れても誰も困らず、
 * 誰も気付かない。訳語を持つぶん、1 件ごとに ja と en の 2 行が黙って積み上がる。
 *
 * 参照の書き方は `messages.<キー>` の 1 通りだけに保つ。添字で引く形（`messages[key]`）を
 * 使い始めると、この検査は使われている文言を未使用と見なして落ちる。
 * そのときは、この検査ごと考え直す。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const messagesFile = fileURLToPath(new URL('./messages.ts', import.meta.url));
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

/** `Messages` の宣言に並ぶキーを取り出す。ja と en は型で同じ形を強制されている。 */
function declaredKeys(): string[] {
  const source = readFileSync(messagesFile, 'utf8');
  const declaration = /export interface Messages \{\n(.*?)\n\}/s.exec(source);
  if (!declaration?.[1]) throw new Error('Messages の宣言が見つかりません');
  return [...declaration[1].matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] as string);
}

/** 画面を構成するファイル。文言そのものと、テストは含めない。 */
function screenSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return screenSources(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (entry.name.includes('.test.')) return [];
    return path === messagesFile ? [] : [path];
  });
}

/** `キー: '値'` の形で書かれた文言の値。ja と en の両方を拾う。 */
function declaredValues(): string[] {
  const source = readFileSync(messagesFile, 'utf8');
  return [...source.matchAll(/^ {2}\w+: (['"])(.*?)\1,$/gm)].map((match) => match[2] as string);
}

describe('画面の文言', () => {
  it('宣言した文言はすべて画面から参照されている', () => {
    const used = screenSources(sourceRoot)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const unused = declaredKeys().filter((key) => !used.includes(`messages.${key}`));

    expect(unused).toEqual([]);
  });

  /**
   * 「まだ実装されていません」と告げる文言を画面へ置かない。
   *
   * 置いた時点では正しくても、その機能が動くようになったとき、文言を消さなくても
   * 誰も落ちない。型検査も通り、テストも通る。実装が進むほど、画面だけが古い状態を
   * 名乗り続けることになる。実際に、休憩・勤務時間の計算・申請・承認が動くようになった
   * あとも「まだ実装されていません」と表示していた。
   *
   * 何が動いていて何が無いかは docs/product/capability-matrix.md を正本にする。
   * 文書なら、能力を足すときに同じ表を触ることになるため、古いまま残りにくい。
   */
  it('実装されていないと告げる文言を持たない', () => {
    const claiming = declaredValues().filter((value) =>
      /未実装|実装されていません|まだ実装|not( yet)? implemented/i.test(value),
    );

    expect(claiming).toEqual([]);
  });
});
