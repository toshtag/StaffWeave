#!/usr/bin/env node
/**
 * 書き出した SBOM が、配布物の構成として読める内容になっているかを確かめる。
 *
 *   pnpm sbom:verify
 *
 * CycloneDX の形式そのものは公式の検証ツールが見る（`sbom:validate`）。
 * ここで見るのは、StaffWeave として満たしていてほしい最低限の契約。
 *
 * - 生成できたことを、正しいことの根拠にしない
 * - 秘密情報と、生成した機械の場所を持ち出さない
 * - workspace と production コンテナを取り違えない
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const OUTPUT_DIR = process.env.SBOM_OUTPUT_DIR ?? 'artifacts/sbom';
const WORKSPACE = 'staffweave-workspace.cdx.json';
const CONTAINER = 'staffweave-container.cdx.json';

const problems = [];

function check(ok, message) {
  if (ok) console.log(`  OK ${message}`);
  else {
    console.log(`  NG ${message}`);
    problems.push(message);
  }
}

/** SBOM のどこかにこの値が現れたら、持ち出してはいけないものが混ざっている。 */
function forbiddenValues() {
  const values = [
    // 検査用の目印。生成の前に環境へ置く。
    process.env.SBOM_CANARY,
    // 実行環境から漏れうる値。設定されている場合だけ見る。
    process.env.DB_PASSWORD,
    process.env.CARD_FINGERPRINT_KEY,
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
  ].filter((value) => typeof value === 'string' && value.length >= 8);
  return [...new Set(values)];
}

/** 生成した機械の場所。成果物へ入ると、配る相手には意味が無いうえ利用者名が漏れる。 */
function localPathPatterns() {
  return [
    { label: 'ホームディレクトリ', value: homedir() },
    { label: 'リポジトリの絶対パス', value: resolve('.') },
  ].filter((entry) => entry.value.length > 1);
}

async function readSbom(name) {
  const path = join(OUTPUT_DIR, name);
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (raw === null) {
    problems.push(`${name} がありません。pnpm sbom:generate を実行してください`);
    return null;
  }
  try {
    return { raw, document: JSON.parse(raw) };
  } catch {
    problems.push(`${name} を JSON として読めません`);
    return null;
  }
}

/** どの SBOM でも満たしていてほしいこと。 */
function checkCommon(name, raw, document) {
  check(document.bomFormat === 'CycloneDX', `${name}: bomFormat が CycloneDX`);
  check(
    typeof document.specVersion === 'string' && document.specVersion.length > 0,
    `${name}: specVersion がある（${document.specVersion ?? 'なし'}）`,
  );
  const components = document.components ?? [];
  check(components.length > 0, `${name}: components がある（${components.length} 件）`);
  check(Array.isArray(document.dependencies), `${name}: dependencies がある`);

  // 同じ参照が二つあると、依存の関係をたどる側がどちらを指すか決められない。
  const refs = components.map((component) => component['bom-ref']).filter(Boolean);
  const duplicated = refs.filter((ref, index) => refs.indexOf(ref) !== index);
  check(duplicated.length === 0, `${name}: bom-ref が重複していない`);

  for (const value of forbiddenValues()) {
    check(!raw.includes(value), `${name}: 秘密情報が混ざっていない`);
  }
  for (const { label, value } of localPathPatterns()) {
    check(!raw.includes(value), `${name}: ${label}を含まない`);
  }
}

/** リポジトリが提供しているパッケージの名前。検査側へ写さず、実物から取る。 */
async function workspacePackageNames() {
  const entries = await readdir('packages', { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readFile(join('packages', entry.name, 'package.json'), 'utf8').catch(
      () => null,
    );
    if (manifest === null) continue;
    names.push(JSON.parse(manifest).name);
  }
  return names.filter(Boolean);
}

function componentNames(document) {
  return new Set((document.components ?? []).map((component) => component.name));
}

function componentTypes(document) {
  return new Set((document.components ?? []).map((component) => component.type));
}

async function checkWorkspace(raw, document) {
  console.log('workspace SBOM');
  checkCommon(WORKSPACE, raw, document);

  const present = componentNames(document);
  const expected = await workspacePackageNames();
  const missing = expected.filter((name) => !present.has(name));
  check(
    missing.length === 0,
    `${WORKSPACE}: workspace のパッケージがすべて出ている${
      missing.length === 0 ? `（${expected.length} 件）` : `（不足: ${missing.join(', ')}）`
    }`,
  );
}

function checkContainer(raw, document) {
  console.log('container SBOM');
  checkCommon(CONTAINER, raw, document);

  const types = componentTypes(document);
  check(types.has('operating-system'), `${CONTAINER}: OS を表す component がある`);

  const purls = (document.components ?? []).map((component) => component.purl ?? '');
  check(
    purls.some((purl) => purl.startsWith('pkg:apk/') || purl.startsWith('pkg:deb/')),
    `${CONTAINER}: OS パッケージがある`,
  );
  check(
    purls.some((purl) => purl.startsWith('pkg:npm/')),
    `${CONTAINER}: npm パッケージがある`,
  );

  // ランタイムが入っていなければ、動かすのに何が要るのかが読めない。
  const names = componentNames(document);
  check(names.has('node'), `${CONTAINER}: Node.js のランタイムがある`);

  // 実行イメージには開発用の道具を入れない。入っていれば Dockerfile 側の問題。
  // TypeScript 7 の処理系の実体は `@typescript/typescript-<platform>` にあり、
  // `typescript` はそれを選ぶだけの入口になった。名前を 1 つ見るだけでは足りない。
  const developmentOnly = ['vitest', '@playwright/test', '@biomejs/biome', 'typescript'];
  const leaked = [
    ...developmentOnly.filter((name) => names.has(name)),
    ...[...names].filter((name) => name.startsWith('@typescript/typescript-')),
  ];
  check(
    leaked.length === 0,
    `${CONTAINER}: 開発用の依存が入っていない${leaked.length === 0 ? '' : `（${leaked.join(', ')}）`}`,
  );

  check(
    typeof document.metadata?.component?.name === 'string',
    `${CONTAINER}: 対象を特定できる metadata がある`,
  );
}

/** 生成直後の中身と、並べて配るチェックサムが一致しているか。 */
async function checkChecksums() {
  console.log('チェックサム');
  for (const name of [WORKSPACE, CONTAINER]) {
    const digestFile = await readFile(join(OUTPUT_DIR, `${name}.sha256`), 'utf8').catch(() => null);
    if (digestFile === null) {
      check(false, `${name}.sha256 がある`);
      continue;
    }
    const [recorded, recordedName] = digestFile.trim().split(/\s+/);
    const raw = await readFile(join(OUTPUT_DIR, name));
    const actual = createHash('sha256').update(raw).digest('hex');
    check(recorded === actual, `${name}: チェックサムが一致する`);
    // 生成した機械の場所を配らない。名前だけを書く。
    check(
      basename(recordedName ?? '') === recordedName && recordedName === name,
      `${name}.sha256: ファイル名だけを書いている`,
    );
  }
}

const workspace = await readSbom(WORKSPACE);
const container = await readSbom(CONTAINER);

if (workspace) await checkWorkspace(workspace.raw, workspace.document);
if (container) checkContainer(container.raw, container.document);
if (workspace && container) await checkChecksums();

console.log('');
if (problems.length > 0) {
  console.log(`SBOM の検査に通らない点が ${problems.length} 件あります。`);
  process.exit(1);
}
console.log('SBOM の検査をすべて通過しました。');
