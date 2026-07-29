import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './types.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE_NAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: MigrationFile[];
  /** 適用済みなのに内容が変更されたマイグレーション。履歴の改変を検出する。 */
  changed: MigrationFile[];
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function loadMigrationFiles(directory = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files: MigrationFile[] = [];

  for (const fileName of entries.sort()) {
    if (!fileName.endsWith('.sql')) continue;
    const matched = FILE_NAME_PATTERN.exec(fileName);
    if (!matched?.[1] || !matched[2]) {
      throw new Error(
        `マイグレーションのファイル名が規約に合いません: ${fileName}（例: 0001_create_workspaces.sql）`,
      );
    }
    const sql = await readFile(join(directory, fileName), 'utf8');
    files.push({
      version: Number(matched[1]),
      name: matched[2],
      fileName,
      sql,
      checksum: checksumOf(sql),
    });
  }

  const versions = new Set<number>();
  for (const file of files) {
    if (versions.has(file.version)) {
      throw new Error(`マイグレーションの版番号が重複しています: ${file.version}`);
    }
    versions.add(file.version);
  }

  return files;
}

async function ensureMigrationTable(db: Database): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    integer     PRIMARY KEY,
      name       text        NOT NULL,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function getMigrationStatus(
  db: Database,
  directory = MIGRATIONS_DIR,
): Promise<MigrationStatus> {
  await ensureMigrationTable(db);
  const files = await loadMigrationFiles(directory);
  const applied = await db.query<AppliedMigration>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
  );
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  const pending: MigrationFile[] = [];
  const changed: MigrationFile[] = [];

  for (const file of files) {
    const record = appliedByVersion.get(file.version);
    if (!record) {
      pending.push(file);
    } else if (record.checksum !== file.checksum) {
      changed.push(file);
    }
  }

  return { applied, pending, changed };
}

export interface MigrateResult {
  appliedVersions: number[];
}

/**
 * 未適用のマイグレーションを版番号順に適用する。
 * 適用済みファイルが変更されている場合は、履歴の不整合として実行を中断する。
 */
export async function migrate(db: Database, directory = MIGRATIONS_DIR): Promise<MigrateResult> {
  const status = await getMigrationStatus(db, directory);

  if (status.changed.length > 0) {
    const names = status.changed.map((file) => file.fileName).join(', ');
    throw new Error(
      `適用済みのマイグレーションが変更されています: ${names}。既存ファイルを編集せず、新しいマイグレーションを追加してください。`,
    );
  }

  const appliedVersions: number[] = [];
  for (const file of status.pending) {
    await db.transaction(async (tx) => {
      await tx.query(file.sql);
      await tx.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [file.version, file.name, file.checksum],
      );
    });
    appliedVersions.push(file.version);
  }

  return { appliedVersions };
}

export { MIGRATIONS_DIR };
