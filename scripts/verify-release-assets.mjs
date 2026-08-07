#!/usr/bin/env node
/**
 * 配るものが、書いてある元と噛み合っているかを確かめる。
 *
 *   node scripts/verify-release-assets.mjs
 *
 * 見るのは 4 つ。
 *
 *   checksum の一覧と、実際のファイルが一致すること
 *   端末の配布物の名前が、package.json の版と一致すること
 *   構成一覧に書いてある commit が、いま見ている commit と一致すること
 *   tag を渡された場合、tag が v<版> であること
 *
 * 「ファイルがある」だけでは、古い成果物を配るのを止められない。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.RELEASE_OUTPUT_DIR ?? 'artifacts/release';
const EXPECTED_SOURCE_SHA = process.env.RELEASE_EXPECTED_SOURCE_SHA;
const TAG = process.env.RELEASE_TAG;

const problems = [];

function check(ok, message) {
  if (ok) console.log(`  OK ${message}`);
  else {
    console.log(`  NG ${message}`);
    problems.push(message);
  }
}

const version = JSON.parse(await readFile('package.json', 'utf8')).version;

console.log('版');
check(version !== '0.0.0', `package.json の版が決まっています（${version}）`);
if (TAG !== undefined && TAG !== '') {
  check(TAG === `v${version}`, `tag ${TAG} が package.json の版と一致しています`);
}

console.log('checksum');
let sums = '';
try {
  sums = await readFile(join(OUTPUT_DIR, 'SHA256SUMS.txt'), 'utf8');
  check(true, 'SHA256SUMS.txt があります');
} catch {
  check(false, 'SHA256SUMS.txt があります');
}

const listed = sums
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => {
    const [digest, ...rest] = line.split(/\s+/);
    return { digest, name: rest.join(' ').replace(/^\*/, '') };
  });

check(listed.length > 0, 'checksum の一覧が空ではありません');

for (const entry of listed) {
  if (entry.name === 'SHA256SUMS.txt' || entry.name === 'release-manifest.txt') continue;
  try {
    const bytes = await readFile(join(OUTPUT_DIR, entry.name));
    const actual = createHash('sha256').update(bytes).digest('hex');
    check(actual === entry.digest, `${entry.name} の中身が checksum と一致しています`);
  } catch {
    check(false, `${entry.name} があります`);
  }
}

console.log('端末の配布物');
const agent = listed.find((entry) => entry.name.startsWith('staffweave-agent-'));
check(agent !== undefined, '端末の配布物が並んでいます');
if (agent !== undefined) {
  check(
    agent.name === `staffweave-agent-${version}.zip`,
    `端末の配布物の名前が版と一致しています（${agent.name}）`,
  );
}

console.log('構成一覧');
for (const name of ['staffweave-workspace.cdx.json', 'staffweave-container.cdx.json']) {
  check(
    listed.some((entry) => entry.name === name),
    `${name} が並んでいます`,
  );
  if (EXPECTED_SOURCE_SHA === undefined || EXPECTED_SOURCE_SHA === '') continue;
  try {
    const document = JSON.parse(await readFile(join(OUTPUT_DIR, name), 'utf8'));
    const recorded = (document.metadata?.component?.properties ?? []).find(
      (property) => property.name === 'staffweave:source-sha',
    )?.value;
    check(
      recorded === EXPECTED_SOURCE_SHA,
      `${name} が指す commit が、いま見ている commit と一致しています`,
    );
  } catch {
    check(false, `${name} を読めます`);
  }
}

console.log('');
if (problems.length > 0) {
  console.error(`配れる状態ではありません（${problems.length} 件）。`);
  process.exit(1);
}
console.log('配るものと元の対応が揃っています。');
