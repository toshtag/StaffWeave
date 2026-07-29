import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from './migrator.js';

async function createMigrationDirectory(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'staffweave-migrations-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content, 'utf8');
  }
  return directory;
}

describe('loadMigrationFiles', () => {
  it('版番号順に読み込む', async () => {
    const directory = await createMigrationDirectory({
      '0002_add_index.sql': 'SELECT 2;',
      '0001_create_table.sql': 'SELECT 1;',
    });

    const files = await loadMigrationFiles(directory);

    expect(files.map((file) => file.version)).toEqual([1, 2]);
    expect(files.map((file) => file.name)).toEqual(['create_table', 'add_index']);
  });

  it('内容が異なればチェックサムも異なる', async () => {
    const directory = await createMigrationDirectory({
      '0001_a.sql': 'SELECT 1;',
      '0002_b.sql': 'SELECT 2;',
    });

    const files = await loadMigrationFiles(directory);

    expect(files[0]?.checksum).not.toBe(files[1]?.checksum);
  });

  it('規約に合わないファイル名は拒否する', async () => {
    const directory = await createMigrationDirectory({ 'create-table.sql': 'SELECT 1;' });

    await expect(loadMigrationFiles(directory)).rejects.toThrow(/ファイル名が規約に合いません/);
  });

  it('版番号の重複を拒否する', async () => {
    const directory = await createMigrationDirectory({
      '0001_first.sql': 'SELECT 1;',
      '0001_second.sql': 'SELECT 2;',
    });

    await expect(loadMigrationFiles(directory)).rejects.toThrow(/版番号が重複/);
  });

  it('sql 以外のファイルは無視する', async () => {
    const directory = await createMigrationDirectory({
      '0001_first.sql': 'SELECT 1;',
      'README.md': '説明',
    });

    const files = await loadMigrationFiles(directory);

    expect(files).toHaveLength(1);
  });

  it('実際のマイグレーションを読み込める', async () => {
    const files = await loadMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.fileName).toBe('0001_create_workspaces.sql');
  });
});
