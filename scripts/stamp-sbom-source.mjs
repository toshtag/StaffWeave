#!/usr/bin/env node
/**
 * 構成一覧へ、元にした commit を書き込む。
 *
 *   node scripts/stamp-sbom-source.mjs <構成一覧> <commit>
 *
 * workspace とコンテナの構成一覧は、作る道具（syft）が commit を書ける。
 * Windows の配布物の構成一覧は別の道具で作るため、書く手立てが無い。
 *
 * 元にした commit が無いと、その構成が「いつのソースから出来ているか」を
 * 受け取った側が確かめられない。配るものと元の対応を見る検証も、
 * 「ファイルがある」以上のことを言えない。
 *
 * 書くのは 1 つの値だけ。秘密は入れない。構成一覧は配るもので、誰でも読む。
 */
import { readFile, writeFile } from 'node:fs/promises';

const PROPERTY = 'staffweave:source-sha';

const [path, sourceSha] = process.argv.slice(2);
if (!path || !sourceSha) {
  console.error('使い方: node scripts/stamp-sbom-source.mjs <構成一覧> <commit>');
  process.exit(1);
}

const document = JSON.parse(await readFile(path, 'utf8'));
document.metadata ??= {};
document.metadata.component ??= { type: 'application', name: 'staffweave-agent' };
const properties = (document.metadata.component.properties ?? []).filter(
  (property) => property.name !== PROPERTY,
);
properties.push({ name: PROPERTY, value: sourceSha });
document.metadata.component.properties = properties;

await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
console.log(`${path} へ元の commit を書きました: ${sourceSha}`);
