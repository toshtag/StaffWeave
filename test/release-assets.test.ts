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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** 成果物を並べ、checksum の一覧まで作る。 */
async function layout(
  options: { agentName?: string; sourceSha?: string; corrupt?: boolean } = {},
): Promise<void> {
  const files: Record<string, string> = {
    [options.agentName ?? `staffweave-agent-${version}.zip`]: 'agent-bundle',
    'staffweave-workspace.cdx.json': sbom(options.sourceSha ?? SOURCE_SHA),
    'staffweave-container.cdx.json': sbom(options.sourceSha ?? SOURCE_SHA),
  };

  const lines: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(output, name), content);
    lines.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`);
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

  it('署名はしない', () => {
    // 署名には所有者の鍵が要る。鍵を持たない者の署名は「誰が配ったか」を示せない。
    expect(workflow).not.toContain('cosign');
    expect(workflow).not.toContain('gpg');
  });
});
