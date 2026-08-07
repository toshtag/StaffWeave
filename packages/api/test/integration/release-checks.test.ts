/**
 * 配る前のゲートが、条件を満たさないときに閉じることを確かめる。
 *
 * 通る場合だけを確かめても、ゲートとしては足りない。
 * 「何があっても通る」ゲートは、置いていないのと同じになる。
 *
 * ここで固定したいのは 3 つ。
 *
 *   判断に要るものが欠けていれば、通さずに落とすこと
 *   tag と package の版が食い違えば落とすこと
 *   その SHA で必須の workflow が成功していなければ落とすこと
 *
 * 実際のプロセスを使うため統合テストへ置く。API への問い合わせは、
 * 手元の HTTP サーバーへ向けて行う。外の GitHub へは出さない。
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const SCRIPT = resolve(REPOSITORY_ROOT, 'scripts/verify-release-checks.mjs');

const VERSION = (
  JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

let server: Server;
let origin: string;
/** workflow ファイル名ごとに、その SHA で返す成功の件数。 */
let successes: Map<string, number>;

/** 成功が記録されている commit。ここ以外の SHA では 0 件を返す。 */
const VERIFIED_SHA = 'a'.repeat(40);
/** 確かめられていない commit。tag を押し間違えた状況にあたる。 */
const UNVERIFIED_SHA = 'b'.repeat(40);

beforeEach(async () => {
  successes = new Map();
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const workflow = url.pathname.split('/').at(-2) ?? '';
    // 問い合わせは SHA ごとに答える。branch の最新が緑であることを、
    // その commit が緑であることとして数えない。
    const headSha = url.searchParams.get('head_sha') ?? '';
    const count = headSha === VERIFIED_SHA ? (successes.get(workflow) ?? 0) : 0;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ total_count: count }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('待ち受けできませんでした');
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function gate(env: Record<string, string>): Promise<{ code: number; message: string }> {
  try {
    const result = await run('node', [SCRIPT], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        GITHUB_API_ORIGIN: origin,
        GITHUB_REPOSITORY: 'example/staffweave',
        GH_TOKEN: 'test-token',
        RELEASE_SHA: VERIFIED_SHA,
        RELEASE_REQUIRED_WORKFLOWS: 'ci.yml,runtime.yml',
        ...env,
      },
    });
    return { code: 0, message: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, message: `${failure.stderr ?? ''}${failure.stdout ?? ''}` };
  }
}

describe('配る前のゲート', () => {
  it('必須の workflow がその SHA で成功していれば通る', async () => {
    successes.set('ci.yml', 1);
    successes.set('runtime.yml', 1);

    const { code } = await gate({});

    expect(code).toBe(0);
  });

  it('1 つでも成功していなければ落とす', async () => {
    successes.set('ci.yml', 1);
    // runtime.yml は 0 件のまま。

    const { code, message } = await gate({});

    expect(code).not.toBe(0);
    expect(message).toContain('runtime.yml');
  });

  /**
   * 古い成功を流用させない。branch の最新が緑であることは、
   * tag を押した commit が緑であることを意味しない。
   */
  it('別の SHA の成功は数えない', async () => {
    successes.set('ci.yml', 1);
    successes.set('runtime.yml', 1);

    const { code, message } = await gate({ RELEASE_SHA: UNVERIFIED_SHA });

    expect(code).not.toBe(0);
    expect(message).toContain(UNVERIFIED_SHA);
  });

  it('対象の commit が渡されていなければ落とす', async () => {
    const { code, message } = await gate({ RELEASE_SHA: '' });

    expect(code).not.toBe(0);
    expect(message).toContain('RELEASE_SHA');
  });

  it('tag と package の版が食い違えば落とす', async () => {
    successes.set('ci.yml', 1);
    successes.set('runtime.yml', 1);

    const { code, message } = await gate({ RELEASE_TAG: 'v0.0.0-not-the-version' });

    expect(code).not.toBe(0);
    expect(message).toContain('一致しません');
  });

  it('tag と package の版が一致していれば通る', async () => {
    successes.set('ci.yml', 1);
    successes.set('runtime.yml', 1);

    const { code } = await gate({ RELEASE_TAG: `v${VERSION}` });

    expect(code).toBe(0);
  });

  it('資格情報が渡されていなければ落とす', async () => {
    successes.set('ci.yml', 1);
    successes.set('runtime.yml', 1);

    const { code, message } = await gate({ GH_TOKEN: '', GITHUB_TOKEN: '' });

    expect(code).not.toBe(0);
    expect(message).toContain('GH_TOKEN');
  });
});
