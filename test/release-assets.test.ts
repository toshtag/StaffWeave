/**
 * 配るものと元の対応を確かめる関門。
 *
 * 通る場合だけを確かめても、関門としては足りない。
 * 「何があっても通る」関門は、置いていないのと同じになる。
 *
 * 実際に成果物を組むには Docker が要るため、ここでは組んだあとの形を作って
 * 検査の側だけを動かす。組む手順そのものは release ワークフローが確かめる。
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const VERIFY = join(REPOSITORY_ROOT, 'scripts/verify-release-assets.mjs');

const SOURCE_SHA = '1111111111111111111111111111111111111111';

let output: string;
let version: string;

function sbom(sourceSha: string): string {
  return JSON.stringify({
    bomFormat: 'CycloneDX',
    metadata: {
      component: {
        name: 'staffweave',
        properties: [{ name: 'staffweave:source-sha', value: sourceSha }],
      },
    },
  });
}

/**
 * 端末の配布物を、中身のある zip として作る。
 *
 * 中の版まで確かめるようになったため、名前だけのファイルでは足りない。
 * 中の版を外から変えられるようにして、食い違ったときに落ちることを見る。
 */
async function agentZip(options: {
  name: string;
  innerVersion: string;
  buildVersion: string;
  buildSha: string;
  reader?: string;
}): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), 'staffweave-agent-zip-'));
  try {
    const bundle = join(work, 'staffweave-agent');
    await mkdir(join(bundle, 'agent'), { recursive: true });
    await writeFile(
      join(bundle, 'package.json'),
      JSON.stringify({ name: 'staffweave-agent', version: options.innerVersion }),
    );
    await writeFile(
      join(bundle, 'agent/build-info.json'),
      JSON.stringify({
        version: options.buildVersion,
        sourceSha: options.buildSha,
        nodeMajor: '24',
        reader: options.reader ?? '',
      }),
    );
    // 組み立て済みの部品が入っている形にする。名前だけでは、端末の前で
    // 初めて読めないと分かる。
    if (options.reader !== undefined && options.reader !== '') {
      await mkdir(join(bundle, 'node_modules/pcsclite/build/Release'), { recursive: true });
      await writeFile(join(bundle, 'node_modules/pcsclite/build/Release/pcsclite.node'), 'native');
    }
    await run('zip', ['-rq', join(output, options.name), 'staffweave-agent'], { cwd: work });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** 成果物を並べ、checksum の一覧まで作る。 */
async function layout(
  options: {
    agentName?: string;
    sourceSha?: string;
    corrupt?: boolean;
    innerVersion?: string;
    buildVersion?: string;
    buildSha?: string;
    windows?: boolean;
    windowsSbomSha?: string;
  } = {},
): Promise<void> {
  const agentName = options.agentName ?? `staffweave-agent-${version}.zip`;
  await agentZip({
    name: agentName,
    innerVersion: options.innerVersion ?? version,
    buildVersion: options.buildVersion ?? version,
    buildSha: options.buildSha ?? options.sourceSha ?? SOURCE_SHA,
  });

  const files: Record<string, string> = {
    'staffweave-workspace.cdx.json': sbom(options.sourceSha ?? SOURCE_SHA),
    'staffweave-container.cdx.json': sbom(options.sourceSha ?? SOURCE_SHA),
  };

  // Windows 向けの配布物は、求められたときだけ並べる。手元では組めないため、
  // 既定では見ない。
  let windowsName: string | null = null;
  if (options.windows === true) {
    windowsName = `staffweave-agent-windows-x64-${version}.zip`;
    await agentZip({
      name: windowsName,
      innerVersion: version,
      buildVersion: version,
      buildSha: options.sourceSha ?? SOURCE_SHA,
      reader: 'pcsclite@1.0.1',
    });
    files['staffweave-agent-windows.cdx.json'] = sbom(
      options.windowsSbomSha ?? options.sourceSha ?? SOURCE_SHA,
    );
  }

  const lines: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(output, name), content);
    lines.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`);
  }
  for (const name of [agentName, ...(windowsName === null ? [] : [windowsName])]) {
    lines.push(
      `${createHash('sha256')
        .update(await readFile(join(output, name)))
        .digest('hex')}  ${name}`,
    );
  }
  await writeFile(join(output, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);

  if (options.corrupt === true) {
    // checksum を書いたあとに中身を差し替える。古い成果物を配る状況と同じ形。
    await writeFile(join(output, 'staffweave-workspace.cdx.json'), sbom(SOURCE_SHA) + ' ');
  }
}

async function verify(
  env: Record<string, string> = {},
): Promise<{ code: number; message: string }> {
  try {
    const result = await run(process.execPath, [VERIFY], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, RELEASE_OUTPUT_DIR: output, ...env },
    });
    return { code: 0, message: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string; stdout?: string };
    return { code: failure.code ?? 1, message: `${failure.stderr ?? ''}${failure.stdout ?? ''}` };
  }
}

beforeEach(async () => {
  output = await mkdtemp(join(tmpdir(), 'staffweave-release-assets-'));
  version = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'package.json'), 'utf8')).version;
});

afterEach(async () => {
  await rm(output, { recursive: true, force: true });
});

describe('配るものの検査', () => {
  it('揃っていれば通す', async () => {
    await layout();

    const { code } = await verify({ RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA });

    expect(code).toBe(0);
  });

  it('checksum の一覧が無ければ通さない', async () => {
    const { code, message } = await verify();

    expect(code).not.toBe(0);
    expect(message).toContain('SHA256SUMS.txt');
  });

  it('中身が checksum と食い違えば通さない', async () => {
    await layout({ corrupt: true });

    const { code, message } = await verify();

    expect(code).not.toBe(0);
    expect(message).toContain('checksum と一致しています');
  });

  it('構成一覧が別の commit を指していれば通さない', async () => {
    await layout({ sourceSha: '2222222222222222222222222222222222222222' });

    const { code, message } = await verify({ RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA });

    expect(code).not.toBe(0);
    expect(message).toContain('いま見ている commit と一致しています');
  });

  it('端末の配布物の名前が版と違えば通さない', async () => {
    await layout({ agentName: 'staffweave-agent-9.9.9.zip' });

    const { code, message } = await verify({ RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA });

    expect(code).not.toBe(0);
    expect(message).toContain('版と一致しています');
  });

  it('tag が版と違えば通さない', async () => {
    await layout();

    const { code, message } = await verify({
      RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA,
      RELEASE_TAG: 'v9.9.9',
    });

    expect(code).not.toBe(0);
    expect(message).toContain('package.json の版と一致しています');
  });

  it('tag が版と同じなら通す', async () => {
    await layout();

    const { code } = await verify({
      RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA,
      RELEASE_TAG: `v${version}`,
    });

    expect(code).toBe(0);
  });
});

describe('release ワークフローの取り決め', () => {
  let workflow: string;

  beforeEach(async () => {
    workflow = await readFile(join(REPOSITORY_ROOT, '.github/workflows/release.yml'), 'utf8');
  });

  it('tag のときだけ Release を作る', () => {
    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toContain("if: github.ref_type == 'tag'");
  });

  it('tag を作らずに確かめられる経路がある', () => {
    // 確かめる経路が無いと、tag を押した本番で初めて壊れていることが分かる。
    expect(workflow).toContain('workflow_dispatch');
  });

  it('配る前に、元との対応を確かめる', () => {
    expect(workflow).toContain('pnpm release:verify');
    expect(workflow).toContain('pnpm sbom:verify');
  });

  /**
   * 中の版が食い違ったまま配れないこと。
   *
   * これまで見ていたのは外側の zip の名前だけだった。名前は組み直すときに
   * 付け替えられる。利用者へ直接渡るのは中身のほうなので、そこが別の版のままだと、
   * 診断・保守・問い合わせで何を配ったのかを辿れない。
   */
  it('配布物の中の版が違えば落とす', async () => {
    await layout({ innerVersion: '0.0.0' });

    const result = await verify();

    expect(result.code).not.toBe(0);
    expect(result.message).toContain('配布物の中の版');
  });

  it('配布物が持つ版が違えば落とす', async () => {
    await layout({ buildVersion: '9.9.9' });

    const result = await verify();

    expect(result.code).not.toBe(0);
    expect(result.message).toContain('配布物が持つ版');
  });

  it('配布物が持つ commit が違えば落とす', async () => {
    await layout({ buildSha: '2222222222222222222222222222222222222222' });

    const result = await verify({ RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA });

    expect(result.code).not.toBe(0);
    expect(result.message).toContain('配布物が持つ commit');
  });

  /**
   * 配る形へ組み直したあとでも、構成一覧の検査が通ること。
   *
   * 組む手順は 1 ファイルに 1 つの `.sha256` を消し、`SHA256SUMS.txt` へ寄せる。
   * 検査の側が個別の `.sha256` しか読まないと、配る直前のこの 1 手順だけが
   * 必ず落ちる。tag を押すまで気付けないため、ここで固定する。
   */
  it('checksum を 1 枚へ寄せた形でも、構成一覧の検査が通る', async () => {
    await layout();

    const result = await run('node', [join(REPOSITORY_ROOT, 'scripts/verify-sbom.mjs')], {
      env: {
        ...process.env,
        SBOM_OUTPUT_DIR: output,
        SBOM_EXPECTED_SOURCE_SHA: SOURCE_SHA,
      },
    }).catch((cause: { stdout?: string; stderr?: string }) => cause);

    expect(`${result.stdout ?? ''}`).toContain('チェックサムが一致する');
    expect(`${result.stdout ?? ''}`).not.toContain(
      'NG staffweave-workspace.cdx.json のチェックサム',
    );
  });

  /**
   * 検査のための逃げ道が、配る経路へ漏れていないこと。
   *
   * `release-manifest.sh` は、コンテナを組む 1 段だけを飛ばせる。数分かかる段を
   * 検査のたびに通す意味が無いため。ただし配る経路で設定されると、digest を
   * 出せないまま「配れる」と言うことになる。
   */
  it('配る経路は、コンテナを組む段を飛ばさない', async () => {
    const manifest = await readFile(join(REPOSITORY_ROOT, 'scripts/release-manifest.sh'), 'utf8');
    expect(manifest).toContain('RELEASE_MANIFEST_SKIP_CONTAINER');

    for (const path of ['.github/workflows/release.yml', '.github/workflows/ci.yml']) {
      const content = await readFile(join(REPOSITORY_ROOT, path), 'utf8');
      expect(content).not.toContain('RELEASE_MANIFEST_SKIP_CONTAINER');
    }
  });

  /**
   * Windows の配布物の構成一覧も、元の commit へ結び付いていること。
   *
   * 「ある」だけでは、いつのソースから出来た構成なのかを言えない。
   * 受け取った側が自分で作り直して確かめることもできない。
   */
  it('Windows の構成一覧が指す commit が違えば落とす', async () => {
    await layout({
      windows: true,
      windowsSbomSha: '3333333333333333333333333333333333333333',
    });

    const result = await verify({
      RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA,
      RELEASE_REQUIRE_WINDOWS_AGENT: '1',
    });

    expect(result.code).not.toBe(0);
    expect(result.message).toContain('staffweave-agent-windows.cdx.json が指す commit');
  });

  it('Windows の配布物が揃っていれば通る', async () => {
    await layout({ windows: true });

    const result = await verify({
      RELEASE_EXPECTED_SOURCE_SHA: SOURCE_SHA,
      RELEASE_REQUIRE_WINDOWS_AGENT: '1',
    });

    expect(result.message).not.toContain('NG');
    expect(result.code).toBe(0);
  });

  it('Windows の配布物を求めているのに無ければ落とす', async () => {
    await layout();

    const result = await verify({ RELEASE_REQUIRE_WINDOWS_AGENT: '1' });

    expect(result.code).not.toBe(0);
    expect(result.message).toContain('staffweave-agent-windows-x64');
  });

  it('署名はしない', () => {
    // 署名には所有者の鍵が要る。鍵を持たない者の署名は「誰が配ったか」を示せない。
    expect(workflow).not.toContain('cosign');
    expect(workflow).not.toContain('gpg');
  });
});
