import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readSecret,
  readSecretFile,
  readSecretStdin,
  requireSecret,
  resetStdinConsumed,
} from './secret-input.js';

/**
 * 登録トークンとカード識別子の受け取り方を固定する。
 *
 * 引数から渡した値はシェル履歴とプロセス一覧へ残る。
 * ファイルと標準入力から受け取れること、値を表示しないことを確かめる。
 *
 * 使うのは明らかにテスト用の値だけで、実在するトークンやカード識別子は扱わない。
 */

const TOKEN = 'test-enrollment-token';

let directory: string;

function warnings(): { warn: (message: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (message) => messages.push(message), messages };
}

function option(argv: string[], overrides: Partial<Parameters<typeof readSecret>[0]> = {}) {
  return {
    name: 'token',
    prompt: '',
    argv,
    warn: () => {},
    interactive: false,
    ...overrides,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-agent-secret-'));
  resetStdinConsumed();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('readSecretFile', () => {
  it('中身を読み、末尾の改行だけを落とす', async () => {
    const path = join(directory, 'token');
    await writeFile(path, `${TOKEN}\n`, 'utf8');
    await chmod(path, 0o600);

    expect(await readSecretFile(path)).toBe(TOKEN);
  });

  it('所有者以外が読めるファイルを断る', async () => {
    const path = join(directory, 'token');
    await writeFile(path, TOKEN, 'utf8');
    await chmod(path, 0o644);

    await expect(readSecretFile(path)).rejects.toThrow(/chmod 600/);
  });

  it('シンボリックリンクを断る', async () => {
    const target = join(directory, 'target');
    await writeFile(target, TOKEN, 'utf8');
    await chmod(target, 0o600);
    const path = join(directory, 'link');
    await symlink(target, path);

    await expect(readSecretFile(path)).rejects.toThrow(/シンボリックリンク/);
  });
});

describe('readSecretStdin', () => {
  it('最後まで読み、末尾の改行だけを落とす', async () => {
    expect(await readSecretStdin(Readable.from([`${TOKEN}\n`]))).toBe(TOKEN);
  });
});

describe('readSecret', () => {
  it('--token-file から読む', async () => {
    const path = join(directory, 'token');
    await writeFile(path, TOKEN, 'utf8');
    await chmod(path, 0o600);

    expect(await readSecret(option(['node', 'agent', '--token-file', path]))).toBe(TOKEN);
  });

  it('引数で渡された場合も受け取るが、注意を出す', async () => {
    const { warn, messages } = warnings();

    const value = await readSecret(option(['node', 'agent', '--token', TOKEN], { warn }));

    expect(value).toBe(TOKEN);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/シェル履歴/);
  });

  // 注意そのものが値を漏らしては意味がない。
  it('注意の文言に値を含めない', async () => {
    const { warn, messages } = warnings();

    await readSecret(option(['node', 'agent', '--token', TOKEN], { warn }));

    expect(messages[0]).not.toContain(TOKEN);
  });

  it('複数の渡し方を同時に指定したら断る', async () => {
    await expect(
      readSecret(option(['node', 'agent', '--token', TOKEN, '--token-stdin'])),
    ).rejects.toThrow(/同時に指定できません/);
  });

  it('--token-stdin から読む', async () => {
    const value = await readSecret(
      option(['node', 'agent', '--token-stdin'], { stdin: Readable.from([`${TOKEN}\n`]) }),
    );

    expect(value).toBe(TOKEN);
  });

  // カード登録は登録トークンとカード識別子の 2 つを要る。
  // 両方を標準入力から読むと、後のほうが空になる。空のまま進めない。
  it('標準入力を 2 つの秘密値へ使えない', async () => {
    await readSecret(
      option(['node', 'agent', '--token-stdin'], { stdin: Readable.from([`${TOKEN}\n`]) }),
    );

    await expect(
      readSecret(
        option(['node', 'agent', '--card-stdin'], {
          name: 'card',
          stdin: Readable.from(['test-card-id\n']),
        }),
      ),
    ).rejects.toThrow(/標準入力から読めるのは 1 つだけです/);
  });

  it('端末が無く、どの渡し方も無ければ undefined を返す', async () => {
    expect(await readSecret(option(['node', 'agent']))).toBeUndefined();
  });
});

describe('requireSecret', () => {
  it('どの渡し方も無ければ、渡し方を示して止める', async () => {
    await expect(requireSecret(option(['node', 'agent']))).rejects.toThrow(
      /--token-file または --token-stdin/,
    );
  });
});
