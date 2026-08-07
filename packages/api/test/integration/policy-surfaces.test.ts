/**
 * 決めごとの検査が、語を残せる経路をすべて見ていることを確かめる。
 *
 * 中身だけを見る検査は、中身だけを直せば通る。branch 名・commit・PR の本文へ
 * 同じ語を書いても止まらない。入口を 1 つ塞いでも、他の入口から同じものが入る。
 *
 * ここでは、経路ごとに 1 件ずつ語を置き、その経路の件数が上がることを見る。
 * 全体が落ちることだけを見ると、どの経路が効いたのかを言えない。
 *
 * 検査そのものを動かすため、実際のプロセスとファイルシステムを使う。
 * 手元と CI の検証範囲を揃えるには、既存の 2 つのどちらかへ入れる必要がある。
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const POLICY = resolve(REPOSITORY_ROOT, 'scripts/check-policy.sh');

/**
 * どこにも現れない語。これを禁止語として渡すと、通る側の形になる。
 *
 * 組み立ててから使う。この検査そのものも追跡ファイルなので、
 * 語をそのまま書くと「中身にある」ことになり、通る側の形にならない。
 */
const ABSENT = ['zzz', 'absent', 'sentinel', 'zzz'].join('-');

interface PolicyRun {
  code: number;
  output: string;
  /** 「指定した禁止語」の行に出た経路ごとの件数。 */
  counts: { content: number; name: number; branch: number; commit: number; pr: number } | null;
}

async function policy(env: Record<string, string>): Promise<PolicyRun> {
  let code = 0;
  let output = '';
  try {
    const result = await run(POLICY, [], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, ...env },
      maxBuffer: 8 * 1024 * 1024,
    });
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    code = failure.code ?? 1;
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }

  // 件数の行は経路ごとに 1 行だけ出る。禁止語の検査は最後に走るため、
  // 最後の一致を読む。
  const matches = [
    ...output.matchAll(
      /内容 (\d+) 件 \/ ファイル名 (\d+) 件 \/ branch (\d+) 件 \/ commit (\d+) 件 \/ PR (\d+) 件/g,
    ),
  ];
  const last = matches.at(-1);
  return {
    code,
    output,
    counts:
      last === undefined
        ? null
        : {
            content: Number(last[1]),
            name: Number(last[2]),
            branch: Number(last[3]),
            commit: Number(last[4]),
            pr: Number(last[5]),
          },
  };
}

/** 直近の commit の題。commit の経路へ確実に当たる語として使う。 */
async function latestCommitSubject(): Promise<string> {
  const { stdout } = await run('git', ['log', '-1', '--format=%s'], { cwd: REPOSITORY_ROOT });
  return stdout.trim();
}

/** 正規表現として渡すため、記号を打ち消す。 */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * commit の範囲。
 *
 * 履歴が 1 件しか無ければ範囲を作れない。黙って空の範囲へ落とすと、
 * commit の経路を見ていないまま「見た」ことになる。読めないなら止める。
 */
const range = async (): Promise<{ POLICY_BASE_SHA: string; POLICY_HEAD_SHA: string }> => {
  let base: string;
  try {
    base = (await run('git', ['rev-parse', 'HEAD~1'], { cwd: REPOSITORY_ROOT })).stdout.trim();
  } catch {
    throw new Error(
      '履歴が 1 件しかないため、commit の範囲を作れません。' +
        'checkout の fetch-depth を 0 にしてください',
    );
  }
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT });
  return { POLICY_BASE_SHA: base, POLICY_HEAD_SHA: head.stdout.trim() };
};

describe('禁止語の検査が見る経路', () => {
  it('語が無ければ通る', async () => {
    const result = await policy({
      POLICY_FORBIDDEN_PATTERN: ABSENT,
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).toBe(0);
  });

  it('追跡ファイルの中身にあれば落ちる', async () => {
    const result = await policy({
      // 本文にも設定にも現れる語。中身の経路へ確実に当たる。
      POLICY_FORBIDDEN_PATTERN: 'StaffWeave',
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).not.toBe(0);
    expect(result.counts?.content).toBeGreaterThan(0);
  });

  it('ファイル名にあれば落ちる', async () => {
    const result = await policy({
      POLICY_FORBIDDEN_PATTERN: 'capability-matrix',
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).not.toBe(0);
    expect(result.counts?.name).toBeGreaterThan(0);
  });

  it('branch 名にあれば落ちる', async () => {
    const result = await policy({
      POLICY_FORBIDDEN_PATTERN: ABSENT,
      POLICY_HEAD_REF: `feat/${ABSENT}`,
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).not.toBe(0);
    expect(result.counts?.branch).toBeGreaterThan(0);
  });

  it('commit の題にあれば落ちる', async () => {
    const result = await policy({
      POLICY_FORBIDDEN_PATTERN: literal(await latestCommitSubject()),
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).not.toBe(0);
    expect(result.counts?.commit).toBeGreaterThan(0);
  });

  it('PR の題と本文にあれば落ちる', async () => {
    const title = await policy({
      POLICY_FORBIDDEN_PATTERN: ABSENT,
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: `題に ${ABSENT} を含む`,
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });
    expect(title.code).not.toBe(0);
    expect(title.counts?.pr).toBeGreaterThan(0);

    const body = await policy({
      POLICY_FORBIDDEN_PATTERN: ABSENT,
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: `本文に ${ABSENT} を含む`,
      ...(await range()),
    });
    expect(body.code).not.toBe(0);
    expect(body.counts?.pr).toBeGreaterThan(0);
  });

  /**
   * 渡し忘れを通さない。
   *
   * 設定の欠落は誰も見ない。通してしまうと、検査が外れたことに気付く機会が
   * 無いまま、外れたままになる。
   */
  it('CI で検査する語が渡されていなければ落ちる', async () => {
    const result = await policy({
      CI: 'true',
      POLICY_FORBIDDEN_PATTERN: '',
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('POLICY_FORBIDDEN_PATTERN');
    // 渡されていない値そのものは無いが、語をログへ出さない形は保つ。
    expect(result.output).not.toContain('grep');
  });

  it('手元では、検査する語が渡されていなくても止めない', async () => {
    const result = await policy({
      CI: '',
      POLICY_FORBIDDEN_PATTERN: '',
      POLICY_HEAD_REF: 'feat/ordinary-branch',
      PR_TITLE: 'ふつうの題',
      PR_BODY: 'ふつうの本文',
      ...(await range()),
    });

    expect(result.code).toBe(0);
  });

  /**
   * CI で branch や commit を渡せなかった場合は、見た経路だけで
   * 「無い」と言わない。渡されていないことを、通った理由にしない。
   */
  it('CI で経路を渡せなければ、見ていないものとして落ちる', async () => {
    const result = await policy({
      CI: 'true',
      POLICY_FORBIDDEN_PATTERN: ABSENT,
      POLICY_HEAD_REF: '',
      POLICY_BASE_SHA: '',
      POLICY_HEAD_SHA: '',
      PR_TITLE: '',
      PR_BODY: '',
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('見ていない経路');
  });
});
