/**
 * リリースの関門が、条件を満たさないときに閉じることを確かめる。
 *
 * 通る場合だけを確かめても、関門としては足りない。
 * 「何があっても通る」関門は、置いていないのと同じになる。
 *
 * 実際に、作業中の変更があっても構成一覧が無くても exit 0 を返していた時期があり、
 * 文章では「配れません」と書いていた。読む人には伝わるが、判定へ組み込むと通る。
 *
 * 統合テストへ置いているのは、実際のプロセスとファイルシステムを使うためで、
 * 手元と CI の検証範囲を揃えるには既存の 2 つのどちらかへ入れる必要がある。
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const MANIFEST = join(REPOSITORY_ROOT, 'scripts/release-manifest.sh');

let sbomDirectory: string;

/**
 * 関門を動かし、終了コードと理由を返す。
 *
 * 構成一覧の置き場は毎回別にする。リポジトリの artifacts を使うと、
 * 検査どうしが互いの成果物を消し合う。
 */
async function gate(): Promise<{ code: number; message: string }> {
  try {
    const result = await run(MANIFEST, [], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, SBOM_OUTPUT_DIR: sbomDirectory },
    });
    return { code: 0, message: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string; stdout?: string };
    return { code: failure.code ?? 1, message: `${failure.stderr ?? ''}${failure.stdout ?? ''}` };
  }
}

beforeEach(async () => {
  sbomDirectory = await mkdtemp(join(tmpdir(), 'staffweave-release-gate-'));
});

afterEach(async () => {
  await rm(sbomDirectory, { recursive: true, force: true });
});

describe('リリースの関門', () => {
  it('構成一覧が無ければ通さない', async () => {
    const { code, message } = await gate();

    expect(code).not.toBe(0);
    expect(message).toContain('構成一覧がありません');
  });

  it('構成一覧が中途半端でも通さない', async () => {
    // 片方だけ置く。「ファイルがある」だけを見ていると通ってしまう。
    await writeFile(join(sbomDirectory, 'staffweave-workspace.cdx.json'), '{}');

    const { code, message } = await gate();

    expect(code).not.toBe(0);
    expect(message).toContain('構成一覧がありません');
  });

  it('構成一覧の中身が、いまの commit と噛み合わなければ通さない', async () => {
    // 形だけ整えて、書いてある commit を別のものにする。
    const stale = {
      bomFormat: 'CycloneDX',
      specVersion: '1.7',
      components: [],
      dependencies: [],
      metadata: {
        component: {
          name: 'staffweave-workspace',
          properties: [{ name: 'staffweave:source-sha', value: '0'.repeat(40) }],
        },
      },
    };
    for (const name of ['staffweave-workspace', 'staffweave-container']) {
      await writeFile(join(sbomDirectory, `${name}.cdx.json`), JSON.stringify(stale));
    }

    const { code, message } = await gate();

    expect(code).not.toBe(0);
    expect(message).toContain('噛み合っていません');
  });

  it('理由を、直せる形で並べる', async () => {
    const { message } = await gate();

    // 「駄目です」だけでは、何を直せばよいのか分からない。
    expect(message).toContain('配れる状態ではありません');
    expect(message).toMatch(/pnpm sbom:generate/);
  });

  it('置き場が読めない場所でも、黙って通さない', async () => {
    // 置き場そのものが無い場合。作られていないのと同じ扱いになる。
    await rm(sbomDirectory, { recursive: true, force: true });
    await mkdir(sbomDirectory, { recursive: true });

    expect((await gate()).code).not.toBe(0);
  });
});
