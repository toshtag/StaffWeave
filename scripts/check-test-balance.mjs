#!/usr/bin/env node
/**
 * 統合テストの所要が、一部のファイルへ偏っていないかを確かめる。
 *
 *   pnpm check:balance [json のパス]
 *
 * 見るのは合計の秒数ではない。CI のランナーは同じ内容でも速さが変わるため、
 * 秒数へ上限を置くと、遅い日に落ちて速い日に通る検査になる。
 *
 * 代わりに、ファイル間の比を見る。比は速さが変わっても動かない。
 * 1 件あたりの所要が他より桁違いに大きいファイルは、たいてい
 * 「テストごとに作り直している重い準備」を抱えている。
 *
 * 実例: 閲覧範囲の検証は、読み取りだけの 55 件のために 3 組織・7 アカウント・
 * 3 名分の打刻から締めまでを 55 回作り直しており、中央値の 10 倍・
 * 統合テスト全体の 57% を占めていた。準備を 1 度だけにして 1/20 になった。
 *
 * 少ない件数のファイルは、準備を分け合う相手がいないぶん比が大きく出る。
 * それ自体は実害が無いので、全体に対する割合も併せて見る。
 */
import { readFile } from 'node:fs/promises';

const REPORT = process.argv[2] ?? 'artifacts/integration-tests.json';

/** 1 件あたりの所要が、中央値のこの倍数を超えたら疑う。いまの最大は約 2 倍。 */
const RATIO_LIMIT = 4;
/** ただし、全体に対する割合がこれ未満なら、比が大きくても実害が無いとみなす。 */
const SHARE_LIMIT = 0.1;

const report = JSON.parse(await readFile(REPORT, 'utf8'));

const files = (report.testResults ?? [])
  .map((result) => ({
    name: result.name.replace(/^.*\/(?=[^/]+$)/, ''),
    duration: result.endTime - result.startTime,
    count: result.assertionResults?.length ?? 0,
  }))
  .filter((file) => file.count > 0 && file.duration > 0);

if (files.length === 0) {
  console.log('  NG テストの記録を読めませんでした:', REPORT);
  process.exit(1);
}

const total = files.reduce((sum, file) => sum + file.duration, 0);
const perTest = files.map((file) => file.duration / file.count).sort((a, b) => a - b);
const median = perTest[Math.floor(perTest.length / 2)];

const scored = files
  .map((file) => ({
    ...file,
    ratio: file.duration / file.count / median,
    share: file.duration / total,
  }))
  .sort((a, b) => b.ratio - a.ratio);

console.log(
  `統合テストの偏り（${files.length} ファイル / 1 件あたりの中央値 ${median.toFixed(0)}ms）`,
);
for (const file of scored.slice(0, 3)) {
  console.log(
    `  -- ${file.ratio.toFixed(1)} 倍 / 全体の ${(file.share * 100).toFixed(1)}%` +
      `（${(file.duration / 1000).toFixed(1)}s・${file.count} 件） ${file.name}`,
  );
}

const heavy = scored.filter((file) => file.ratio > RATIO_LIMIT && file.share >= SHARE_LIMIT);

if (heavy.length === 0) {
  console.log(`  OK 中央値の ${RATIO_LIMIT} 倍を超えて時間を占めるファイルはありません`);
  process.exit(0);
}

for (const file of heavy) {
  console.log(
    `  NG ${file.name} は 1 件あたり中央値の ${file.ratio.toFixed(1)} 倍で、` +
      `統合テスト全体の ${(file.share * 100).toFixed(1)}% を占めています`,
  );
}
console.log('');
console.log('テストごとに重い準備を作り直していないか確かめてください。');
console.log('読み取りだけを確かめる describe なら、useSharedData で 1 度だけ作れます。');
console.log('準備が本当に必要なら、この脚本の RATIO_LIMIT を、理由を添えて上げてください。');
process.exit(1);
