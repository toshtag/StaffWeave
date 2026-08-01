import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database, Queryable } from './types.js';

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
  applied_at: Date;
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

async function ensureMigrationTable(db: Queryable): Promise<void> {
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
  db: Queryable,
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
 * マイグレーションの適用を直列化するためのロック鍵。
 * アドバイザリロックはデータベース全体で 1 つの空間を共有するため、
 * 他の用途と重ならない値を固定で持つ。
 */
const MIGRATION_LOCK_KEY = 4_113_020_251;

/**
 * 未適用のマイグレーションを版番号順に適用する。
 * 適用済みファイルが変更されている場合は、履歴の不整合として実行を中断する。
 *
 * 適用のあいだはアドバイザリロックを取り、同時に走る他のプロセスを待たせる。
 * 待っていた側は、先に適用が終わった状態を読み直すため、二重には適用しない。
 */
export async function migrate(db: Database, directory = MIGRATIONS_DIR): Promise<MigrateResult> {
  // 適用を直列化する。複数のインスタンスを同時に起動しても、
  // 同じマイグレーションが並行して走らないようにする。
  return db.session(async (connection) => {
    await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      return await applyPending(connection, directory);
    } finally {
      // 正常終了でも例外でも必ず解放する。接続が切れた場合は PostgreSQL が解放する。
      await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  });
}

/**
 * ロックを取った接続の上で適用する。
 * 別の接続を取りに行くと、接続数の上限が小さい構成では自分の待ちで詰まる。
 */
async function applyPending(connection: Queryable, directory: string): Promise<MigrateResult> {
  const status = await getMigrationStatus(connection, directory);

  if (status.changed.length > 0) {
    const names = status.changed.map((file) => file.fileName).join(', ');
    throw new Error(
      `適用済みのマイグレーションが変更されています: ${names}。既存ファイルを編集せず、新しいマイグレーションを追加してください。`,
    );
  }

  const appliedVersions: number[] = [];
  for (const file of status.pending) {
    // 1 ファイルずつ確定させる。途中で失敗しても、それより前の適用は残る。
    await connection.query('BEGIN');
    try {
      await connection.query(file.sql);
      await connection.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [file.version, file.name, file.checksum],
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    }
    appliedVersions.push(file.version);
  }

  return { appliedVersions };
}

export { MIGRATIONS_DIR };
