import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@staffweave/db';
import { createDatabase, MIGRATIONS_DIR, migrate } from '@staffweave/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 組織のまとまりを守る外部キーが、すでに動いている環境で何をするかを固定する。
 *
 * 組織をまたぐ参照が残っている環境では、どの組織が正しいかは業務の判断であり、
 * 移行で決めてよいものではない。0020 はその場合に止まり、該当する行を示す。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const CLEAN = 'staffweave_organization_reference_clean_test';
const MISMATCHED = 'staffweave_organization_reference_mismatch_test';

const LAST_VERSION_BEFORE_SCOPING = 19;

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

interface Organizations {
  workspaceId: string;
  homeId: string;
  otherId: string;
  homeSiteId: string;
  otherSiteId: string;
}

async function createOrganizations(db: Database, slug: string): Promise<Organizations> {
  const workspaces = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, slug],
  );
  const workspaceId = workspaces[0]?.id ?? '';

  const organizations = await db.query<{ id: string; code: string }>(
    `INSERT INTO organizations (workspace_id, code, name)
     VALUES ($1, 'HQ', '本社'), ($1, 'BRANCH', '支社') RETURNING id, code`,
    [workspaceId],
  );
  const homeId = organizations.find((row) => row.code === 'HQ')?.id ?? '';
  const otherId = organizations.find((row) => row.code === 'BRANCH')?.id ?? '';

  const sites = await db.query<{ id: string; organization_id: string }>(
    `INSERT INTO sites (workspace_id, organization_id, code, name, time_zone)
     VALUES ($1, $2, 'TOKYO', '東京', 'Asia/Tokyo'), ($1, $3, 'OSAKA', '大阪', 'Asia/Tokyo')
     RETURNING id, organization_id`,
    [workspaceId, homeId, otherId],
  );

  return {
    workspaceId,
    homeId,
    otherId,
    homeSiteId: sites.find((row) => row.organization_id === homeId)?.id ?? '',
    otherSiteId: sites.find((row) => row.organization_id === otherId)?.id ?? '',
  };
}

async function createEmployee(
  db: Database,
  organizations: Organizations,
  input: { employeeNumber: string; primarySiteId?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO employees
       (workspace_id, organization_id, employee_number, display_name, primary_site_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      organizations.workspaceId,
      organizations.homeId,
      input.employeeNumber,
      `従業員 ${input.employeeNumber}`,
      input.primarySiteId ?? null,
    ],
  );
  return rows[0]?.id ?? '';
}

let admin: Database;
let clean: Database;
let mismatched: Database;
let cleanOrganizations: Organizations;

beforeAll(async () => {
  admin = createDatabase({ connectionString: urlFor('postgres'), maxConnections: 1 });
  for (const name of [CLEAN, MISMATCHED]) {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  }

  clean = createDatabase({ connectionString: urlFor(CLEAN), maxConnections: 1 });
  mismatched = createDatabase({ connectionString: urlFor(MISMATCHED), maxConnections: 1 });

  // 0019 までを適用し、組織の中で閉じた参照を保存してから 0020 を適用する。
  await migrate(clean, await migrationsUpTo(LAST_VERSION_BEFORE_SCOPING));
  cleanOrganizations = await createOrganizations(clean, 'default');
  await createEmployee(clean, cleanOrganizations, {
    employeeNumber: 'E001',
    primarySiteId: cleanOrganizations.homeSiteId,
  });
  await migrate(clean);

  // 組織をまたぐ参照を残したまま 0020 を迎える環境。適用はここでは行わない。
  await migrate(mismatched, await migrationsUpTo(LAST_VERSION_BEFORE_SCOPING));
  const organizations = await createOrganizations(mismatched, 'default');
  await createEmployee(mismatched, organizations, {
    employeeNumber: 'E001',
    primarySiteId: organizations.otherSiteId,
  });
}, 60_000);

afterAll(async () => {
  await clean?.close();
  await mismatched?.close();
  for (const name of [CLEAN, MISMATCHED]) {
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin?.close();
});

describe('組織の中で閉じているデータベース', () => {
  it('保存されていた主拠点をそのまま残す', async () => {
    const rows = await clean.query<{ primary_site_id: string | null }>(
      "SELECT primary_site_id FROM employees WHERE employee_number = 'E001'",
    );

    expect(rows[0]?.primary_site_id).toBe(cleanOrganizations.homeSiteId);
  });

  it('別の組織の拠点は主拠点にできない', async () => {
    await expect(
      createEmployee(clean, cleanOrganizations, {
        employeeNumber: 'E002',
        primarySiteId: cleanOrganizations.otherSiteId,
      }),
    ).rejects.toThrow(/employees_site_fkey/);
  });

  it('同じ組織の拠点なら主拠点にできる', async () => {
    await expect(
      createEmployee(clean, cleanOrganizations, {
        employeeNumber: 'E003',
        primarySiteId: cleanOrganizations.homeSiteId,
      }),
    ).resolves.toBeTruthy();
  });

  it('拠点を消しても従業員は残り、主拠点だけが空になる', async () => {
    const employeeId = await createEmployee(clean, cleanOrganizations, {
      employeeNumber: 'E004',
      primarySiteId: cleanOrganizations.homeSiteId,
    });
    await clean.query('DELETE FROM sites WHERE id = $1', [cleanOrganizations.homeSiteId]);

    const rows = await clean.query<{ organization_id: string; primary_site_id: string | null }>(
      'SELECT organization_id, primary_site_id FROM employees WHERE id = $1',
      [employeeId],
    );

    expect(rows[0]?.primary_site_id).toBeNull();
    expect(rows[0]?.organization_id).toBe(cleanOrganizations.homeId);
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(clean);

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('組織をまたぐ参照が残っているデータベース', () => {
  it('該当する行を示して適用を止める', async () => {
    await expect(migrate(mismatched)).rejects.toThrow(/組織をまたぐ参照が残っています/);
  });

  it('止まった時点では外部キーを差し替えない', async () => {
    const rows = await mismatched.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_constraint
        WHERE conname = 'sites_id_workspace_organization_key'`,
    );

    expect(rows[0]?.count).toBe(0);
  });

  it('参照を外せば適用できる', async () => {
    await mismatched.query('UPDATE employees SET primary_site_id = NULL');

    // 後から足した版も一緒に適用されるため、この移行が通ったことだけを見る。
    await expect(migrate(mismatched)).resolves.toEqual(
      expect.objectContaining({ appliedVersions: expect.arrayContaining([20]) }),
    );
  });
});
