/**
 * 画面のどこからも参照されない文言が残っていないことを確かめる。
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

describe('画面の文言', () => {
  it('宣言した文言はすべて画面から参照されている', () => {
    const used = screenSources(sourceRoot)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const unused = declaredKeys().filter((key) => !used.includes(`messages.${key}`));

    expect(unused).toEqual([]);
  });
});
