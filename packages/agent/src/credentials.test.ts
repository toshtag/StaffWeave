import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceCredentials } from './credentials.js';
import { generateKeyPair, loadCredentials, saveCredentials } from './credentials.js';

/**
 * 資格情報のファイルには端末の秘密鍵とカード指紋用の鍵が入る。
 *
 * `mode` を指定した書き込みは、すでにあるファイルの権限を変えない。
 * 通常の読み書きはシンボリックリンクの参照先へ届く。
 * どちらも「動くけれど守れていない」形なので、テストで固定する。
 *
 * 生成した秘密鍵は一時ディレクトリの外へ出さない。
 */

let directory: string;
let path: string;

function credentials(overrides: Partial<DeviceCredentials> = {}): DeviceCredentials {
  const keyPair = generateKeyPair();
  return {
    baseUrl: 'http://127.0.0.1:8787',
    deviceId: '00000000-0000-4000-8000-000000000000',
    workspaceSlug: 'default',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
    nextSequence: 1,
    ...overrides,
  };
}

/** 所有者以外に与えられている権限。0 なら所有者だけが読める。 */
async function sharedBitsOf(target: string): Promise<number> {
  return (await stat(target)).mode & 0o077;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-credentials-'));
  path = join(directory, 'agent.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('saveCredentials', () => {
  it('新しいファイルを所有者だけが読める権限で作る', async () => {
    await saveCredentials(path, credentials());

    expect(await sharedBitsOf(path)).toBe(0);
  });

  // mode を指定した書き込みは、すでにあるファイルの権限を変えない。
  it('既存の緩い権限のファイルでも、保存後は所有者だけが読める', async () => {
    await writeFile(path, '{}\n', 'utf8');
    await chmod(path, 0o644);

    await saveCredentials(path, credentials());

    expect(await sharedBitsOf(path)).toBe(0);
  });

  it('保存先がシンボリックリンクなら書き込まない', async () => {
    const target = join(directory, 'target.json');
    await writeFile(target, 'そのまま\n', 'utf8');
    await symlink(target, path);

    await expect(saveCredentials(path, credentials())).rejects.toThrow(/シンボリックリンク/);
    expect(await readFile(target, 'utf8')).toBe('そのまま\n');
  });

  it('保存先が通常のファイルでなければ書き込まない', async () => {
    const asDirectory = join(directory, 'agent-directory.json');
    await mkdir(asDirectory);

    await expect(saveCredentials(asDirectory, credentials())).rejects.toThrow(
      /通常のファイルではありません/,
    );
  });

  it('書き込みの途中で失敗しても、元の資格情報を失わない', async () => {
    const original = credentials({ nextSequence: 7 });
    await saveCredentials(path, original);

    // JSON にできない値を混ぜ、書き込みの途中で失敗させる。
    const broken = { ...original, nextSequence: 8n as unknown as number };
    await expect(saveCredentials(path, broken as DeviceCredentials)).rejects.toThrow();

    expect((await loadCredentials(path)).nextSequence).toBe(7);
  });

  it('置き換えに使った一時ファイルを残さない', async () => {
    await saveCredentials(path, credentials());
    await saveCredentials(path, credentials({ nextSequence: 2 }));

    expect(await readdir(directory)).toEqual(['agent.json']);
  });
});

describe('loadCredentials', () => {
  it('保存した内容をそのまま読み戻せる', async () => {
    const saved = credentials({ cardFingerprintKey: 'a'.repeat(64) });
    await saveCredentials(path, saved);

    expect(await loadCredentials(path)).toEqual(saved);
  });

  it('読み込み元がシンボリックリンクなら読まない', async () => {
    const target = join(directory, 'target.json');
    await saveCredentials(target, credentials());
    await symlink(target, path);

    await expect(loadCredentials(path)).rejects.toThrow(/シンボリックリンク/);
  });

  // 他の利用者から読める状態で置かれていた時点で、秘密鍵は守れていない。
  it('所有者以外が読める権限なら読まない', async () => {
    await saveCredentials(path, credentials());
    await chmod(path, 0o644);

    await expect(loadCredentials(path)).rejects.toThrow(/chmod 600/);
  });

  it('ファイルが無ければその旨を伝える', async () => {
    await expect(loadCredentials(path)).rejects.toThrow(/資格情報がありません/);
  });

  // 保存した後にファイルを書き換えられることがある。読み込むたびに確かめ直す。
  it('保存された接続先がループバック以外の http なら読まない', async () => {
    await saveCredentials(path, credentials({ baseUrl: 'https://staffweave.example' }));
    const saved = JSON.parse(await readFile(path, 'utf8')) as DeviceCredentials;
    await writeFile(
      path,
      JSON.stringify({ ...saved, baseUrl: 'http://staffweave.example' }, null, 2),
      'utf8',
    );
    await chmod(path, 0o600);

    await expect(loadCredentials(path)).rejects.toThrow(/保存された接続先が暗号化されていません/);
  });

  it('保存された接続先を正規化して返す', async () => {
    await saveCredentials(path, credentials({ baseUrl: 'http://127.1:8787/' }));

    expect((await loadCredentials(path)).baseUrl).toBe('http://127.0.0.1:8787');
  });
});
