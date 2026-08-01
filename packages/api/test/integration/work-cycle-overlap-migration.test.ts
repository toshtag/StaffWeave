import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@staffweave/db';
import { createDatabase, MIGRATIONS_DIR, migrate } from '@staffweave/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 有効期間の排他制約が、すでに動いている環境で何をするかを固定する。
 *
 * 重複した割当が残っている環境では、どちらを残すかは業務の判断であり、
 * 移行で選んでよいものではない。0019 はその場合に止まり、該当する従業員を示す。
 * 重複が無い環境では、そのまま制約が入り、以後の重複を DB が断る。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const CLEAN = 'staffweave_work_cycle_clean_test';
const OVERLAPPING = 'staffweave_work_cycle_overlap_test';

const LAST_VERSION_BEFORE_EXCLUSION = 18;

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL が設定されていません。');
  return url;
}

function urlFor(databaseName: string): string {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** 指定した版までのマイグレーションだけを置いた一時ディレクトリ。内容は原本と同一にする。 */
async function migrationsUpTo(version: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'staffweave-migrations-'));
  for (const fileName of await readdir(MIGRATIONS_DIR)) {
    if (!fileName.endsWith('.sql')) continue;
    if (Number(fileName.slice(0, 4)) > version) continue;
    await copyFile(join(MIGRATIONS_DIR, fileName), join(directory, fileName));
  }
  return directory;
}

interface Workspace {
  workspaceId: string;
  employeeId: string;
  workCycleId: string;
  patternId: string;
}

/** 勤務周期の割当を保存できる最小の一式を作る。 */
async function createWorkspaceWith(db: Database, slug: string): Promise<Workspace> {
  const workspaces = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, slug],
  );
  const workspaceId = workspaces[0]?.id ?? '';
  const organizations = await db.query<{ id: string }>(
    "INSERT INTO organizations (workspace_id, code, name) VALUES ($1, 'HQ', '本社') RETURNING id",
    [workspaceId],
  );
  const employees = await db.query<{ id: string }>(
    `INSERT INTO employees (workspace_id, organization_id, employee_number, display_name)
     VALUES ($1, $2, 'E001', '勤怠 花子') RETURNING id`,
    [workspaceId, organizations[0]?.id ?? ''],
  );
  const patterns = await db.query<{ id: string }>(
    `INSERT INTO work_patterns (workspace_id, code, name, start_minutes, end_minutes, break_minutes)
     VALUES ($1, 'DAY', '日勤', 540, 1080, 60) RETURNING id`,
    [workspaceId],
  );
  const cycles = await db.query<{ id: string }>(
    `INSERT INTO work_cycles (workspace_id, code, name, cycle_length)
     VALUES ($1, 'EVERY_DAY', '毎日勤務', 1) RETURNING id`,
    [workspaceId],
  );
  return {
    workspaceId,
    employeeId: employees[0]?.id ?? '',
    workCycleId: cycles[0]?.id ?? '',
    patternId: patterns[0]?.id ?? '',
  };
}

async function assign(
  db: Database,
  workspace: Workspace,
  input: { effectiveFrom: string; effectiveTo?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO employee_work_cycles
       (workspace_id, employee_id, work_cycle_id, anchor_date, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $4, $5)`,
    [
      workspace.workspaceId,
      workspace.employeeId,
      workspace.workCycleId,
      input.effectiveFrom,
      input.effectiveTo ?? null,
    ],
  );
}

let admin: Database;
let clean: Database;
let overlapping: Database;
let cleanWorkspace: Workspace;

beforeAll(async () => {
  admin = createDatabase({ connectionString: urlFor('postgres'), maxConnections: 1 });
  for (const name of [CLEAN, OVERLAPPING]) {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  }

  clean = createDatabase({ connectionString: urlFor(CLEAN), maxConnections: 1 });
  overlapping = createDatabase({ connectionString: urlFor(OVERLAPPING), maxConnections: 1 });

  // 0018 までを適用し、当時の形で重ならない割当を保存してから 0019 を適用する。
  await migrate(clean, await migrationsUpTo(LAST_VERSION_BEFORE_EXCLUSION));
  cleanWorkspace = await createWorkspaceWith(clean, 'default');
  await assign(clean, cleanWorkspace, { effectiveFrom: '2026-04-01', effectiveTo: '2026-04-30' });
  await assign(clean, cleanWorkspace, { effectiveFrom: '2026-05-01' });
  await migrate(clean);

  // 重複したまま 0019 を迎える環境。適用はここでは行わない。
  await migrate(overlapping, await migrationsUpTo(LAST_VERSION_BEFORE_EXCLUSION));
  const workspace = await createWorkspaceWith(overlapping, 'default');
  await assign(overlapping, workspace, { effectiveFrom: '2026-04-01' });
  await assign(overlapping, workspace, { effectiveFrom: '2026-04-01' });
}, 60_000);

afterAll(async () => {
  await clean?.close();
  await overlapping?.close();
  for (const name of [CLEAN, OVERLAPPING]) {
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin?.close();
});

describe('重複が無いデータベース', () => {
  it('保存されていた割当をそのまま残す', async () => {
    const rows = await clean.query<{ effective_from: string; effective_to: string | null }>(
      `SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
              to_char(effective_to, 'YYYY-MM-DD') AS effective_to
         FROM employee_work_cycles ORDER BY effective_from`,
    );

    expect(rows).toEqual([
      { effective_from: '2026-04-01', effective_to: '2026-04-30' },
      { effective_from: '2026-05-01', effective_to: null },
    ]);
  });

  it('重なる期間の割当を受け付けない', async () => {
    await expect(
      assign(clean, cleanWorkspace, { effectiveFrom: '2026-04-15', effectiveTo: '2026-04-20' }),
    ).rejects.toThrow(/employee_work_cycles_no_overlap/);
  });

  it('終わりの無い割当は、以降のどの期間とも重なる', async () => {
    await expect(assign(clean, cleanWorkspace, { effectiveFrom: '2027-01-01' })).rejects.toThrow(
      /employee_work_cycles_no_overlap/,
    );
  });

  it('接した期間なら受け付ける', async () => {
    const other = await createWorkspaceWith(clean, 'adjacent');
    await assign(clean, other, { effectiveFrom: '2026-04-01', effectiveTo: '2026-04-07' });

    await expect(assign(clean, other, { effectiveFrom: '2026-04-08' })).resolves.toBeUndefined();
  });

  it('従業員が違えば同じ期間を持てる', async () => {
    const other = await createWorkspaceWith(clean, 'other-employee');

    await expect(assign(clean, other, { effectiveFrom: '2026-05-01' })).resolves.toBeUndefined();
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(clean);

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('重複が残っているデータベース', () => {
  it('該当する従業員を示して適用を止める', async () => {
    await expect(migrate(overlapping)).rejects.toThrow(/有効期間が重複する勤務周期の割当/);
  });

  it('止まった時点では制約を作らない', async () => {
    const rows = await overlapping.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_constraint
        WHERE conname = 'employee_work_cycles_no_overlap'`,
    );

    expect(rows[0]?.count).toBe(0);
  });

  it('重複を解消すれば適用できる', async () => {
    await overlapping.query(
      `UPDATE employee_work_cycles SET effective_to = '2026-04-07'
        WHERE id = (SELECT id FROM employee_work_cycles ORDER BY created_at, id LIMIT 1)`,
    );
    await overlapping.query(
      `UPDATE employee_work_cycles SET effective_from = '2026-04-08'
        WHERE effective_to IS NULL`,
    );

    // 後から足した版も一緒に適用されるため、この移行が通ったことだけを見る。
    await expect(migrate(overlapping)).resolves.toEqual(
      expect.objectContaining({ appliedVersions: expect.arrayContaining([19]) }),
    );
  });
});
