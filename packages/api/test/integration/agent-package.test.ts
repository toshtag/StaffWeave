/**
 * 打刻端末の配布物が、渡してよい形になっていることを確かめる。
 *
 * 見るのは 2 つ。
 *
 *   動かすのに要らないものを混ぜていないこと
 *   サービスとして登録する手順が、配布物の中に揃っていること
 *
 * 配布物は現場の端末へ置かれる。テストや型定義まで入れると、
 * 現場に置くものが増え、何が動いているのかが読みにくくなる。
 *
 * 統合テストへ置いているのは、実際のプロセスとファイルシステムを使うためで、
 * 手元と CI の検証範囲を揃えるには既存の 2 つのどちらかへ入れる必要がある。
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const PACKAGE_AGENT = join(REPOSITORY_ROOT, 'scripts/package-agent.sh');

let directory: string;
let bundle: string;

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path.slice(bundle.length + 1));
  }
  return files;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-agent-package-'));
  bundle = join(directory, 'staffweave-agent');
  await run(PACKAGE_AGENT, [directory], { cwd: REPOSITORY_ROOT });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('打刻端末の配布物', () => {
  it('動かすのに要るものだけを入れる', async () => {
    const files = await filesUnder(bundle);

    expect(files).toContain('packages/agent/src/cli.ts');
    expect(files).toContain('packages/contracts/src/index.ts');
    expect(files).toContain('packages/domain/src/index.ts');
    // 検査は現場で動かさない。入れると、置くものが増えて何が動くのか読みにくくなる。
    expect(files.filter((file) => file.includes('.test.'))).toEqual([]);
  });

  it('サービスとして登録・削除する手順を同梱する', async () => {
    const files = await filesUnder(bundle);

    expect(files).toContain('install-service.ps1');
    expect(files).toContain('uninstall-service.ps1');
  });

  it('登録の手順は、落ちたときに間を空けて上げ直す', async () => {
    const script = await readFile(join(bundle, 'install-service.ps1'), 'utf8');

    // 上げ続けると、直らない不具合で端末の電源を使い切る。
    expect(script).toContain('sc.exe failure');
    expect(script).toMatch(/restart\/\d+/);
  });

  it('登録を外しても、資格情報と送信待ちを消さない', async () => {
    const script = await readFile(join(bundle, 'uninstall-service.ps1'), 'utf8');

    // 送れていない打刻が残っている可能性がある。消すかどうかは人が決める。
    expect(script).toContain('残しています');
    expect(script).not.toMatch(/Remove-Item|del\s/);
  });

  it('実行ファイルは作らない', async () => {
    const files = await filesUnder(bundle);

    // 署名と配布の方式が決まっていないうちに、署名なしの実行ファイルを出さない。
    expect(files.filter((file) => file.endsWith('.exe') || file.endsWith('.msi'))).toEqual([]);
  });

  it('実機で確かめることを、配布物へ添える', async () => {
    const readme = await readFile(join(bundle, 'README.md'), 'utf8');

    expect(readme).toContain('実機で確かめること');
    expect(readme).toContain('Windows のサービス');
  });

  it('作り直しても同じものになる', async () => {
    const before = await filesUnder(bundle);
    const sizes = await Promise.all(
      before.map(async (file) => (await stat(join(bundle, file))).size),
    );

    await run(PACKAGE_AGENT, [directory], { cwd: REPOSITORY_ROOT });
    const after = await filesUnder(bundle);
    const afterSizes = await Promise.all(
      after.map(async (file) => (await stat(join(bundle, file))).size),
    );

    // 前回の中身が残ると、消したファイルが配布物に残り続ける。
    expect(after.sort()).toEqual(before.sort());
    expect(afterSizes).toEqual(sizes);
  });
});

describe('端末の常駐', () => {
  const AGENT = join(REPOSITORY_ROOT, 'packages/agent');

  /**
   * 常駐したまま動き続け、合図で止まることを、実際にプロセスを立てて確かめる。
   *
   * 待ちの実装を誤ると、他に用の無いプロセスは最初の待ちで終了する。
   * ログには「開始しました」だけが残るため、落ちたことに気付けない。
   */
  it('立ち上げたあと動き続け、停止の合図で止まる', async () => {
    const store = join(directory, 'agent.json');
    // 実際のサービスと同じく、間に何も挟まず直接立てる。
    // 包むものを挟むと、停止の合図が本体まで届かず、止まり方を確かめられない。
    const child = spawn(
      join(AGENT, 'node_modules/.bin/tsx'),
      ['src/cli.ts', 'serve', '--store', store],
      {
        cwd: AGENT,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    const lines: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => lines.push(chunk.toString()));

    const exited = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    });
    // 待ちの時間より長く置く。ここで終わっていれば、常駐できていない。
    await new Promise((resolve) => setTimeout(resolve, 7_000));
    expect(child.exitCode).toBeNull();

    child.kill('SIGTERM');
    await exited;

    expect(lines.join('')).toContain('agent.stopped');
  }, 30_000);
});
