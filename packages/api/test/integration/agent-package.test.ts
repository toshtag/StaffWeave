/**
 * 打刻端末の配布物が、そのまま動くことを確かめる。
 *
 * いちばん大事なのは「配布物を、リポジトリの外で起動できること」。
 * 中身の形だけを見ていると、置いただけでは起動しない配布物を通してしまう。
 * 実際に、TypeScript のまま配っていた時期があり、形の検査は通っていた。
 *
 * したがってここでは、リポジトリの道具を一切使わず、
 * 配布物の中の JS を素の node で起動する。
 *
 * 統合テストへ置いているのは、実際のプロセスとファイルシステムを使うためで、
 * 手元と CI の検証範囲を揃えるには既存の 2 つのどちらかへ入れる必要がある。
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/*
 * 配布物は 1 度だけ作る。
 *
 * 作るのに、コンパイルと他所の部品の取り寄せが要る。検査ごとに作り直すと、
 * この 1 ファイルだけで統合テスト全体の 2 割近くを使う。
 * 検査は配布物を読むだけで、書き換えない。作り直す必要は無い。
 */
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-agent-package-'));
  bundle = join(directory, 'staffweave-agent');
  await run(PACKAGE_AGENT, [directory], { cwd: REPOSITORY_ROOT });
}, 300_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('打刻端末の配布物', () => {
  it('コンパイル済みの JS を入れ、TypeScript は入れない', async () => {
    const files = await filesUnder(bundle);

    expect(files).toContain('agent/cli.js');
    expect(files).toContain('node_modules/@staffweave/contracts/index.js');
    expect(files).toContain('node_modules/@staffweave/domain/index.js');
    // Node は .ts を読めない。自分たちの側に混ざっていれば、配る形を間違えている。
    // 他所の部品が持つ型定義は数えない。動かすのには使われない。
    expect(
      files.filter((file) => file.endsWith('.ts') && !file.startsWith('node_modules/')),
    ).toEqual([]);
    // 自分たちの検査は現場で動かさない。他所の部品が持つ検査までは面倒を見ない。
    expect(
      files.filter((file) => file.includes('.test.') && !file.startsWith('node_modules/')),
    ).toEqual([]);
  });

  it('動かすのに要る他所の部品を同梱する', async () => {
    const files = await filesUnder(bundle);

    // 現場の端末は通信できないことがある。置いてから取り寄せる形にはできない。
    for (const name of ['ajv', 'ajv-formats', 'fsmxjs']) {
      expect(files.some((file) => file.startsWith(`node_modules/${name}/`))).toBe(true);
    }
  });

  it('サービスの登録は、コンパイル済みの JS を起動する', async () => {
    const script = await readFile(join(bundle, 'install-service.ps1'), 'utf8');

    expect(script).toContain('agent/cli.js');
    // .ts を Node へ渡す形が残っていれば、登録しても起動しない。
    // 見るのは登録する道筋だけ。説明の文へ .ts が出るのは構わない。
    expect(script).not.toContain('cli.ts');
    expect(script).not.toMatch(/binPath[\s\S]*\.ts/);
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

describe('配布物を、リポジトリの外で起動する', () => {
  /**
   * 素の node で起動する。リポジトリの道具（tsx や node_modules）は一切使わない。
   * 使うと、配布物が足りていなくても通ってしまう。
   */
  function runBundle(args: string[]): ReturnType<typeof spawn> {
    return spawn(process.execPath, args, {
      cwd: bundle,
      stdio: ['ignore', 'pipe', 'pipe'],
      // リポジトリの解決に頼っていないことを確かめる。
      env: { ...process.env, NODE_PATH: '' },
    });
  }

  async function collect(child: ReturnType<typeof spawn>): Promise<{
    code: number | null;
    output: string;
  }> {
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', (value) => resolve(value));
    });
    return { code, output };
  }

  it('diagnose が動く', async () => {
    const store = join(directory, 'agent.json');
    const { code, output } = await collect(
      runBundle(['agent/cli.js', 'diagnose', '--store', store]),
    );

    expect(output).toContain('送信待ち');
    expect(code).toBe(0);
  }, 30_000);

  it('知らない命令には、使える命令を伝えて終わる', async () => {
    const { code, output } = await collect(runBundle(['agent/cli.js', '存在しない命令']));

    expect(output).toContain('serve');
    expect(code).toBe(1);
  }, 30_000);

  it('serve が常駐し、停止の合図で止まる', async () => {
    const store = join(directory, 'agent.json');
    const child = runBundle(['agent/cli.js', 'serve', '--store', store]);

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    });

    // 待ちの時間より長く置く。ここで終わっていれば、常駐できていない。
    await new Promise((resolve) => setTimeout(resolve, 7_000));
    expect(child.exitCode).toBeNull();

    child.kill('SIGTERM');
    await exited;

    expect(output).toContain('agent.started');
    expect(output).toContain('agent.stopped');
  }, 40_000);
});
