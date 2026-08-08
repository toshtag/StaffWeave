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
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

  it('常駐の登録は、コンパイル済みの JS を起動する', async () => {
    const script = await readFile(join(bundle, 'install-startup.ps1'), 'utf8');

    expect(script).toContain('agent/cli.js');
    // .ts を Node へ渡す形が残っていれば、登録しても起動しない。
    // 見るのは登録する道筋だけ。説明の文へ .ts が出るのは構わない。
    expect(script).not.toContain('cli.ts');
    expect(script).not.toMatch(/New-ScheduledTaskAction[\s\S]*\.ts/);
  });

  /**
   * Windows のサービスとしては登録しないこと。
   *
   * サービスとして動くプロセスは SCM と話す入口を持っている必要があり、
   * node.exe も私たちの cli.js も持っていない。`sc.exe create` は登録の情報を
   * 作るだけなので登録は通り、`sc.exe start` で初めて落ちる。実機で初めて
   * 分かる場所だった（docs/decisions/0002-windows-residency.md）。
   */
  it('Windows のサービスとしては登録しない', async () => {
    const files = await filesUnder(bundle);
    expect(files).not.toContain('install-service.ps1');
    expect(files).not.toContain('uninstall-service.ps1');

    for (const name of ['install-startup.ps1', 'uninstall-startup.ps1']) {
      const script = await readFile(join(bundle, name), 'utf8');
      expect(script).not.toMatch(/sc\.exe\s+create/);
      expect(script).not.toMatch(/New-Service/);
    }
  });

  it('起動時に常駐させ、外す手順を同梱する', async () => {
    const files = await filesUnder(bundle);

    expect(files).toContain('install-startup.ps1');
    expect(files).toContain('uninstall-startup.ps1');

    const install = await readFile(join(bundle, 'install-startup.ps1'), 'utf8');
    // 端末の起動時に始める。利用者のログオンを待つ形にすると、誰も
    // ログオンしない据え置きの端末では上がらない。
    expect(install).toContain('-AtStartup');
    expect(install).toContain('ServiceAccount');
    // 実行時間の上限を置くと、常駐が途中で打ち切られる。
    expect(install).toMatch(/ExecutionTimeLimit[\s\S]*Seconds 0/);
  });

  it('常駐の登録は、落ちたときに間を空けて上げ直す', async () => {
    const script = await readFile(join(bundle, 'install-startup.ps1'), 'utf8');

    // 上げ続けると、直らない不具合で端末の電源を使い切る。
    expect(script).toContain('-RestartInterval');
    expect(script).toContain('-RestartCount');
  });

  it('外す手順は、まず行儀よく終わらせてから止める', async () => {
    const script = await readFile(join(bundle, 'uninstall-startup.ps1'), 'utf8');

    // タスクスケジューラの停止はプロセスを強制的に終わらせるだけで、
    // Windows には「行儀よく終われ」という合図が無い。
    expect(script).toMatch(/cli\.js stop|\$cli stop/);
    expect(script).toContain('Stop-ScheduledTask');
  });

  it('常駐を外しても、資格情報と送信待ちを消さない', async () => {
    const script = await readFile(join(bundle, 'uninstall-startup.ps1'), 'utf8');

    // 送れていない打刻が残っている可能性がある。消すかどうかは人が決める。
    expect(script).toContain('残しています');
    expect(script).not.toMatch(/Remove-Item|del\s/);
  });

  /**
   * 登録した常駐 1 つで、読み取りから送信まで完結すること。
   *
   * これまで登録していたのは送信だけで、カードの読み取りは常駐に入って
   * いなかった。実機で #194 と #195 を別々に通しても、「配った端末が物理カードを
   * 読み、回線断でも失わず、復旧後に送る」という経路は証明できない。
   */
  it('常駐は、読み取りと送信を 1 つのプロセスで起動する', async () => {
    const script = await readFile(join(bundle, 'install-startup.ps1'), 'utf8');

    expect(script).toContain("'station'");
    // 読み取り装置を付けない端末のために、送信だけの道も残す。
    expect(script).toContain("'serve'");
    expect(script).toMatch(/-Argument[\s\S]*\$mode/);
  });

  /**
   * 配布物だけで、対応する読み取りの受け渡しを読み込めること。
   *
   * これまでは `createPcscTransport` を利用者が書く前提だった。据え置き端末を
   * 置く人に TypeScript を書かせるのは、配布物だけで動くとは言えない。
   */
  it('対応する読み取りの受け渡しを同梱する', async () => {
    const files = await filesUnder(bundle);
    expect(files).toContain('agent/card/pcsc-winscard.js');

    // 配布物だけの場所から読み込めること。取り寄せていない部品を指したまま
    // 配ると、端末の前で初めて動かないと分かる。
    const loaded = (await import(join(bundle, 'agent/card/pcsc-winscard.js'))) as {
      createPcscTransport?: unknown;
      READER_MISSING_MESSAGE?: unknown;
    };
    expect(typeof loaded.createPcscTransport).toBe('function');

    // 装置の部品が入っていない端末では、何をすればよいかを言って止まる。
    await expect(
      (loaded.createPcscTransport as (load: () => Promise<unknown>) => Promise<unknown>)(() =>
        Promise.reject(new Error('not installed')),
      ),
    ).rejects.toThrow('staffweave-agent-windows-x64');
  });

  /**
   * 端末で取り寄せる手順を、正規の道として残さないこと。
   *
   * 現場の端末は通信できないことがあり、組み立ての道具も無い。あとで取り寄せる
   * 形にすると、配布物だけでは物理カードを読めず、確かめた構成と実際に動く構成も
   * 別になる。読み取りの部品は、その OS の上で組むときに入れる。
   */
  /**
   * 配布物の根から普通に起動したとき、同梱の受け渡しまで辿り着くこと。
   *
   * Windows へ登録すると、作業ディレクトリは配布物の根になる。既定の場所を
   * 作業ディレクトリからの相対で書いていたため、隣の `agent/card/...` ではなく
   * 根の直下を探していた。`--pcsc` を省いた普通の経路が通っていなかった。
   *
   * ここでは `diagnose` を使う。装置を開くところまで行くが、部品が無ければ
   * 「配布物に入っていません」で止まる。読み込む場所を間違えていれば、
   * 「読み込めませんでした」になり、言葉が変わる。
   */
  it('配布物の根から起動しても、同梱の受け渡しを読む', async () => {
    // 資格情報は配布物の外へ置く。中へ置くと、配布物の中身を数える検査が変わる。
    const outside = await mkdtemp(join(tmpdir(), 'staffweave-diagnose-'));
    const store = join(outside, 'agent.json');
    await writeFile(
      store,
      JSON.stringify({
        baseUrl: 'https://staffweave.invalid',
        deviceId: '00000000-0000-4000-8000-000000000000',
        workspaceSlug: 'default',
        privateKeyPem: '',
        publicKeyPem: '',
        nextSequence: 1,
      }),
      { mode: 0o600 },
    );

    // 作業ディレクトリは配布物の根。Windows へ登録したときと同じ形。
    const { stdout } = await run(process.execPath, ['agent/cli.js', 'diagnose', '--store', store], {
      cwd: bundle,
    });

    await rm(outside, { recursive: true, force: true });

    // 受け渡しまでは辿り着いている。止まっているのは装置の部品が無いため。
    expect(stdout).toContain('配布物に入っていません');
    expect(stdout).not.toContain('読み込めませんでした');
  });

  it('端末で部品を取り寄せる手順を同梱しない', async () => {
    const files = await filesUnder(bundle);
    expect(files).not.toContain('install-reader.ps1');
    expect(files.filter((file) => file.endsWith('.ps1'))).toEqual([
      'install-startup.ps1',
      'install-store.ps1',
      'uninstall-startup.ps1',
    ]);
  });

  it('配布物が、対応する Node の版を持つ', async () => {
    const build = JSON.parse(await readFile(join(bundle, 'agent/build-info.json'), 'utf8')) as {
      nodeMajor: string;
      reader: string;
    };
    const pinned = (await readFile(join(REPOSITORY_ROOT, '.nvmrc'), 'utf8')).trim();

    // 組み立てた部品は Node の版ごとの取り決めに合わせて作られる。
    // 別の版で動かすと、装置を開こうとした時点で落ちる。
    expect(build.nodeMajor).toBe(pinned);
    // ここで組むのは OS を選ばない配布物。読み取りの部品は入らない。
    expect(build.reader).toBe('');
  });

  /**
   * 配布物が、自分の版と元の commit を持つこと。
   *
   * これまで zip の中の版は `0.0.0` に固定されていた。外側の名前だけが
   * `staffweave-agent-0.1.0.zip` で、中身は何の版か言えない状態だった。
   */
  it('配布物が、版と元の commit を持つ', async () => {
    const root = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const inner = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(inner.version).toBe(root.version);

    const build = JSON.parse(await readFile(join(bundle, 'agent/build-info.json'), 'utf8')) as {
      version: string;
      sourceSha: string;
    };
    expect(build.version).toBe(root.version);
    // 秘密は入れない。診断は保守の人が現場で実行し、画面と端末の履歴に残る。
    expect(Object.keys(build).sort()).toEqual(['nodeMajor', 'reader', 'sourceSha', 'version']);
  });

  /**
   * 資格情報の置き場を用意する手順を同梱し、無いまま登録しないこと。
   *
   * CLI の既定はいまいる場所（`.staffweave-agent.json`）で、Windows の登録の
   * 既定は ProgramData だった。手順どおりに進めると、資格情報といまの登録が
   * 別の場所を指す。登録そのものは成功し、端末の起動後に読めずに落ちる。
   */
  it('資格情報の置き場を用意する手順を同梱する', async () => {
    const files = await filesUnder(bundle);
    expect(files).toContain('install-store.ps1');

    const script = await readFile(join(bundle, 'install-store.ps1'), 'utf8');
    // 権限を継承させない。継承したままだと ProgramData の既定で Users にも開く。
    expect(script).toContain('SetAccessRuleProtection');
    expect(script).toContain('NT AUTHORITY\\SYSTEM');
    expect(script).toContain('BUILTIN\\Administrators');
    // 次に何をすればよいかを、その場で言う。
    expect(script).toContain('enroll');
  });

  it('資格情報が無ければ、常駐として登録しない', async () => {
    const script = await readFile(join(bundle, 'install-startup.ps1'), 'utf8');

    expect(script).toContain('Test-Path $Store');
    // 何をすればよいかまで言う。「無い」だけでは、次の手が分からない。
    expect(script).toContain('install-store.ps1');
    expect(script).toContain('enroll');
    // 置き場が広く開いていれば断る。端末の秘密鍵が入る。
    expect(script).toContain('Get-Acl');
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
