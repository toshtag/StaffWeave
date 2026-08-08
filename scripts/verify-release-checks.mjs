#!/usr/bin/env node
/**
 * 配る前に、その commit が確かめられていることを機械的に見る。
 *
 *   node scripts/verify-release-checks.mjs
 *
 * これまでは、tag を押すと Release の workflow だけが動き、そのまま配布まで
 * 進んだ。運用する人が事前にゲートを実行する前提だったため、押し間違えれば
 * 確かめていない commit がそのまま出ていく。
 *
 * ここで見るのは 2 つ。
 *
 *   tag の名前と package の版が一致していること
 *   その commit（正確な SHA）で、必須の workflow が成功していること
 *
 * 「その SHA で」を落とさない。branch の最新が緑であることは、tag を押した
 * commit が緑であることを意味しない。古い成功を流用させない。
 *
 * 判断に要るものが 1 つでも欠けていれば、通さずに落とす。
 * 確かめられなかったことを、確かめた扱いにしない。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * 成功していなければ配らない workflow。ファイル名で指す。
 *
 * Windows の常駐は Linux の runner では確かめられない。配る側の workflow にある
 * Windows の job は配布物を組むだけで、登録・開始・停止・削除までは行わない。
 * ここへ入れておかないと、その SHA で Windows の検査が落ちていても、
 * 未実行でも、関門は通ってしまう。
 */
const DEFAULT_REQUIRED_WORKFLOWS = 'ci.yml,runtime.yml,sbom.yml,windows-agent.yml';

const REQUIRED_WORKFLOWS = (process.env.RELEASE_REQUIRED_WORKFLOWS ?? DEFAULT_REQUIRED_WORKFLOWS)
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

const problems = [];

function fail(message) {
  problems.push(message);
}

// 空の一覧は受け取らない。渡し方を間違えて空になったとき、何も確かめないまま
// 通ってしまう。「確かめる相手が居ない」ことを、確かめた扱いにしない。
if (REQUIRED_WORKFLOWS.length === 0) {
  fail('必須の workflow が 1 つも指定されていません（RELEASE_REQUIRED_WORKFLOWS）');
}

const sha = (process.env.RELEASE_SHA ?? '').trim();
const tag = (process.env.RELEASE_TAG ?? '').trim();
const repository = (process.env.GITHUB_REPOSITORY ?? '').trim();
const token = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '').trim();

if (sha === '') fail('RELEASE_SHA が渡されていません');
if (repository === '') fail('GITHUB_REPOSITORY が渡されていません');
if (token === '') fail('GH_TOKEN が渡されていません');

/**
 * tag と package の版を一致させる。
 *
 * 食い違ったまま配ると、配布物の中の版と、人が見る tag が別のものになる。
 * あとから「どの版を配ったのか」を成果物だけでは言えなくなる。
 */
if (tag !== '') {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const expected = `v${manifest.version}`;
  if (tag !== expected) {
    fail(`tag ${tag} と package の版 ${expected} が一致しません`);
  }
}

// 問い合わせ先は差し替えられるようにする。検査から外の GitHub へ出さないため。
const API_ORIGIN = (process.env.GITHUB_API_ORIGIN ?? 'https://api.github.com').replace(/\/$/, '');

async function successfulRunsFor(workflow) {
  const url =
    `${API_ORIGIN}/repos/${repository}/actions/workflows/${workflow}/runs` +
    `?head_sha=${encodeURIComponent(sha)}&status=success&per_page=1`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    // 問い合わせに失敗したことを「成功が無い」とも「ある」とも読まない。
    throw new Error(`${workflow} の実行を読めませんでした（${response.status}）`);
  }
  const body = await response.json();
  return body.total_count ?? 0;
}

if (problems.length === 0) {
  for (const workflow of REQUIRED_WORKFLOWS) {
    try {
      const count = await successfulRunsFor(workflow);
      if (count === 0) {
        // 何をすれば通せるかを添える。対象を絞った workflow は、文書だけを
        // 直した commit では走らない。走っていないことは、確かめていない
        // ことと区別が付かないため通さないが、手で走らせる道は示す。
        fail(
          `${workflow} が ${sha} で成功していません` +
            `（この commit で走っていない場合は、その ref で手動実行してください）`,
        );
      } else {
        process.stdout.write(`  OK ${workflow} は ${sha} で成功しています\n`);
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : `${workflow} を確かめられませんでした`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write('配れません。\n');
  for (const problem of problems) process.stderr.write(`  NG ${problem}\n`);
  process.exit(1);
}

process.stdout.write('この commit は必須の workflow で確かめられています。\n');
