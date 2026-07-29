/**
 * OpenAPI 3.1 文書をファイルへ書き出す。
 * 外部連携や Agent 実装が、リポジトリを取り込まずに契約だけを参照できるようにする。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../src/openapi.js';

const outputPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
const version = process.env.STAFFWEAVE_VERSION ?? '0.0.0';

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(buildOpenApiDocument(version), null, 2)}\n`, 'utf8');

console.log(`OpenAPI 文書を書き出しました: ${outputPath}`);
