import { execFile } from 'node:child_process';
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
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * バックアップが作るファイルの機密性を固定する。
 *
 * 出力には業務データ、パスワードハッシュ、セッションと API キーのハッシュ、
 * Webhook の署名鍵が入る。`umask 022` の環境で素朴に書くと `0644` になり、
 * 同じホストの他の利用者から読める。応答も内容も変わらないため、
 * ここで権限そのものを確かめないと気付けない。
 *
 * データベースへは触れない。`docker` をテスト用の実行ファイルへ差し替え、
 * 一時ディレクトリの中だけで確かめる。
 *
 * 統合テストへ置いているのは、これが実際のプロセスとファイルシステムを使うためで、
 * 手元と CI の検証範囲を揃えるには既存の 2 つのどちらかへ入れる必要がある。
 */

const run = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const BACKUP = join(REPOSITORY_ROOT, 'scripts/backup.sh');

const DUMP_CONTENT = 'PGDMP-fake-dump\n';

let directory: string;

/** `docker exec ... pg_dump` の代わりに、決まった内容を書き出す実行ファイル。 */
async function installFakeDocker(script: string): Promise<string> {
  const binary = join(directory, 'bin');
  await mkdir(binary, { recursive: true });
  await writeFile(join(binary, 'docker'), script, 'utf8');
  await chmod(join(binary, 'docker'), 0o755);
  return binary;
}

async function runBackup(
  output: string,
  options: { docker?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const binary = await installFakeDocker(
    options.docker ?? `#!/bin/sh\nprintf '${DUMP_CONTENT.trim()}\\n'\n`,
  );
  return run('/bin/sh', [BACKUP, output], {
    cwd: directory,
    // 一般的な環境の既定。素朴に書けば 0644 になる条件で確かめる。
    env: { ...process.env, PATH: `${binary}:${process.env.PATH ?? ''}` },
  });
}

/** 所有者以外へ与えている権限。0 なら所有者だけが読める。 */
async function sharedBitsOf(target: string): Promise<number> {
  return (await stat(target)).mode & 0o077;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-backup-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('scripts/backup.sh', () => {
  it('保存先のディレクトリを所有者だけが読める権限で作る', async () => {
    await runBackup('backups/staffweave.dump');

    expect(await sharedBitsOf(join(directory, 'backups'))).toBe(0);
  });

  it('バックアップを所有者だけが読める権限で作る', async () => {
    await runBackup('backups/staffweave.dump');

    const output = join(directory, 'backups/staffweave.dump');
    expect(await sharedBitsOf(output)).toBe(0);
    expect(await readFile(output, 'utf8')).toBe(DUMP_CONTENT);
  });

  it('すでにある緩い権限のファイルへ書いても、所有者だけが読める', async () => {
    await mkdir(join(directory, 'backups'), { recursive: true });
    await chmod(join(directory, 'backups'), 0o700);
    const output = join(directory, 'backups/staffweave.dump');
    await writeFile(output, 'ふるい\n', 'utf8');
    await chmod(output, 0o644);

    await runBackup('backups/staffweave.dump');

    expect(await sharedBitsOf(output)).toBe(0);
  });

  it('保存先が所有者以外から読めるディレクトリなら作らない', async () => {
    await mkdir(join(directory, 'shared'), { recursive: true });
    await chmod(join(directory, 'shared'), 0o755);

    await expect(runBackup('shared/staffweave.dump')).rejects.toThrow(/chmod 700/);
    expect(await readdir(join(directory, 'shared'))).toEqual([]);
  });

  it('保存先がシンボリックリンクなら書き込まない', async () => {
    await mkdir(join(directory, 'backups'), { recursive: true });
    await chmod(join(directory, 'backups'), 0o700);
    const target = join(directory, 'target.dump');
    await writeFile(target, 'そのまま\n', 'utf8');
    await symlink(target, join(directory, 'backups/staffweave.dump'));

    await expect(runBackup('backups/staffweave.dump')).rejects.toThrow(/シンボリックリンク/);
    expect(await readFile(target, 'utf8')).toBe('そのまま\n');
  });

  // 出力先へ直接書くと、失敗しても最終名のファイルが残り、正常なものと見分けがつかない。
  it('書き出しに失敗したら、最終名のファイルを残さない', async () => {
    await expect(
      runBackup('backups/staffweave.dump', {
        docker: '#!/bin/sh\nprintf "とちゅう"\nexit 1\n',
      }),
    ).rejects.toThrow();

    expect(await readdir(join(directory, 'backups'))).toEqual([]);
  });

  it('書き出しに失敗しても、以前のバックアップを壊さない', async () => {
    await runBackup('backups/staffweave.dump');

    await expect(
      runBackup('backups/staffweave.dump', { docker: '#!/bin/sh\nexit 1\n' }),
    ).rejects.toThrow();

    expect(await readFile(join(directory, 'backups/staffweave.dump'), 'utf8')).toBe(DUMP_CONTENT);
  });

  it('置き換えに使った一時ファイルを残さない', async () => {
    await runBackup('backups/staffweave.dump');

    expect(await readdir(join(directory, 'backups'))).toEqual(['staffweave.dump']);
  });
});
