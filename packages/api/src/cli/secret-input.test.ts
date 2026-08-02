import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSecret, readSecretFile, readSecretStdin } from './secret-input.js';

/**
 * 秘密値の受け取り方を固定する。
 *
 * 引数から渡した値はシェル履歴とプロセス一覧へ残る。ファイルと標準入力から
 * 受け取れること、値を表示しないことを確かめる。
 *
 * 使うのは明らかにテスト用の値だけで、実在するパスワードやトークンは扱わない。
 */

const SECRET = 'test-secret-value';

let directory: string;

function warnings(): { warn: (message: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (message) => messages.push(message), messages };
}

async function writeSecretFile(name: string, content: string, mode = 0o600): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, content, 'utf8');
  await chmod(path, mode);
  return path;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-secret-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('readSecretFile', () => {
  it('中身を読み、末尾の改行だけを落とす', async () => {
    const path = await writeSecretFile('secret', `${SECRET}\n`);

    expect(await readSecretFile(path)).toBe(SECRET);
  });

  it('値に含まれる空白は残す', async () => {
    const path = await writeSecretFile('secret', 'ふたつ の ことば\n');

    expect(await readSecretFile(path)).toBe('ふたつ の ことば');
  });

  it('所有者以外が読めるファイルを断る', async () => {
    const path = await writeSecretFile('secret', SECRET, 0o644);

    await expect(readSecretFile(path)).rejects.toThrow(/chmod 600/);
  });

  it('シンボリックリンクを断る', async () => {
    const target = await writeSecretFile('target', SECRET);
    const path = join(directory, 'link');
    await symlink(target, path);

    await expect(readSecretFile(path)).rejects.toThrow(/シンボリックリンク/);
  });

  it('通常のファイルでなければ断る', async () => {
    const path = join(directory, 'as-directory');
    await mkdir(path);

    await expect(readSecretFile(path)).rejects.toThrow(/通常のファイルではありません/);
  });

  it('読めないファイルの理由に中身を含めない', async () => {
    await expect(readSecretFile(join(directory, 'missing'))).rejects.toThrow(/読めません/);
  });
});

describe('readSecretStdin', () => {
  it('最後まで読み、末尾の改行だけを落とす', async () => {
    expect(await readSecretStdin(Readable.from([`${SECRET}\n`]))).toBe(SECRET);
  });

  it('分割して届いても組み立てる', async () => {
    expect(await readSecretStdin(Readable.from(['test-', 'secret-', 'value']))).toBe(SECRET);
  });
});

describe('readSecret', () => {
  it('--<name>-file から読む', async () => {
    const path = await writeSecretFile('secret', SECRET);
    const { warn, messages } = warnings();

    const value = await readSecret({
      name: 'password',
      prompt: '',
      argv: ['node', 'bootstrap', '--password-file', path],
      warn,
    });

    expect(value).toBe(SECRET);
    expect(messages).toEqual([]);
  });

  it('引数で渡された場合も受け取るが、注意を出す', async () => {
    const { warn, messages } = warnings();

    const value = await readSecret({
      name: 'password',
      prompt: '',
      argv: ['node', 'bootstrap', '--password', SECRET],
      warn,
    });

    expect(value).toBe(SECRET);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/シェル履歴/);
  });

  // 注意そのものが値を漏らしては意味がない。
  it('注意の文言に値を含めない', async () => {
    const { warn, messages } = warnings();

    await readSecret({
      name: 'password',
      prompt: '',
      argv: ['node', 'bootstrap', '--password', SECRET],
      warn,
    });

    expect(messages[0]).not.toContain(SECRET);
  });

  it('複数の渡し方を同時に指定したら断る', async () => {
    const path = await writeSecretFile('secret', SECRET);
    const { warn } = warnings();

    await expect(
      readSecret({
        name: 'password',
        prompt: '',
        argv: ['node', 'bootstrap', '--password', SECRET, '--password-file', path],
        warn,
      }),
    ).rejects.toThrow(/同時に指定できません/);
  });

  it('指定が無く端末も無ければ undefined を返す', async () => {
    const { warn } = warnings();

    const value = await readSecret({
      name: 'password',
      prompt: '',
      argv: ['node', 'bootstrap'],
      warn,
    });

    expect(value).toBeUndefined();
  });
});
