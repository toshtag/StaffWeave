import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@staffweave/db';
import { createDatabase, MIGRATIONS_DIR, migrate } from '@staffweave/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 配属を契約の組織へ閉じる制約が、すでに動いている環境で何をするかを固定する。
 *
 * 組織の食い違いや期間の重なりが残っている環境では、どちらが正しいかは業務の判断であり、
 * 移行で決めてよいものではない。0021 はその場合に止まり、該当する配属を示す。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const CLEAN = 'staffweave_assignment_clean_test';
const MISMATCHED = 'staffweave_assignment_mismatch_test';

const LAST_VERSION_BEFORE_SCOPING = 20;

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

interface Fixture {
  workspaceId: string;
  employerId: string;
  hostId: string;
  employerEmployeeId: string;
  hostEmployeeId: string;
  hostSiteId: string;
  employerSiteId: string;
  contractId: string;
}

/** 雇用元と受入組織、それぞれの従業員と拠点、契約を作る。 */
async function createFixture(db: Database, slug: string): Promise<Fixture> {
  const workspaces = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, slug],
  );
  const workspaceId = workspaces[0]?.id ?? '';

  const organizations = await db.query<{ id: string; code: string }>(
    `INSERT INTO organizations (workspace_id, code, name)
     VALUES ($1, 'EMPLOYER', '雇用元'), ($1, 'HOST', '受入先') RETURNING id, code`,
    [workspaceId],
  );
  const employerId = organizations.find((row) => row.code === 'EMPLOYER')?.id ?? '';
  const hostId = organizations.find((row) => row.code === 'HOST')?.id ?? '';

  const sites = await db.query<{ id: string; organization_id: string }>(
    `INSERT INTO sites (workspace_id, organization_id, code, name, time_zone)
     VALUES ($1, $2, 'HOST1', '受入先の工場', 'Asia/Tokyo'),
            ($1, $3, 'EMPLOYER1', '雇用元の事務所', 'Asia/Tokyo')
     RETURNING id, organization_id`,
    [workspaceId, hostId, employerId],
  );

  const employees = await db.query<{ id: string; organization_id: string }>(
    `INSERT INTO employees (workspace_id, organization_id, employee_number, display_name)
     VALUES ($1, $2, 'E001', '派遣 花子'), ($1, $3, 'E002', '受入 次郎')
     RETURNING id, organization_id`,
    [workspaceId, employerId, hostId],
  );

  const contracts = await db.query<{ id: string }>(
    `INSERT INTO assignment_contracts
       (workspace_id, code, name, employer_organization_id, host_organization_id, starts_on)
     VALUES ($1, 'C001', '受入契約', $2, $3, '2026-04-01') RETURNING id`,
    [workspaceId, employerId, hostId],
  );

  return {
    workspaceId,
    employerId,
    hostId,
    employerEmployeeId: employees.find((row) => row.organization_id === employerId)?.id ?? '',
    hostEmployeeId: employees.find((row) => row.organization_id === hostId)?.id ?? '',
    hostSiteId: sites.find((row) => row.organization_id === hostId)?.id ?? '',
    employerSiteId: sites.find((row) => row.organization_id === employerId)?.id ?? '',
    contractId: contracts[0]?.id ?? '',
  };
}

interface AssignmentInput {
  employeeId: string;
  workplaceSiteId?: string;
  startsOn: string;
  endsOn?: string;
}

/** 0021 より前の形の配属。契約の組織を持つ列はまだ無い。 */
async function assignBeforeScoping(
  db: Database,
  fixture: Fixture,
  input: AssignmentInput,
): Promise<void> {
  await db.query(
    `INSERT INTO employee_assignments
       (workspace_id, employee_id, assignment_contract_id, workplace_site_id, starts_on, ends_on)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      fixture.workspaceId,
      input.employeeId,
      fixture.contractId,
      input.workplaceSiteId ?? null,
      input.startsOn,
      input.endsOn ?? null,
    ],
  );
}

/** 0021 適用後の形。契約の組織は要求ではなく契約から複製する。 */
async function assign(db: Database, fixture: Fixture, input: AssignmentInput): Promise<void> {
  await db.query(
    `INSERT INTO employee_assignments
       (workspace_id, employee_id, assignment_contract_id, workplace_site_id, starts_on, ends_on,
        employer_organization_id, host_organization_id)
     SELECT $1, $2, contracts.id, $4, $5, $6,
            contracts.employer_organization_id, contracts.host_organization_id
       FROM assignment_contracts AS contracts
      WHERE contracts.workspace_id = $1 AND contracts.id = $3`,
    [
      fixture.workspaceId,
      input.employeeId,
      fixture.contractId,
      input.workplaceSiteId ?? null,
      input.startsOn,
      input.endsOn ?? null,
    ],
  );
}

let admin: Database;
let clean: Database;
let mismatched: Database;
let cleanFixture: Fixture;

beforeAll(async () => {
  admin = createDatabase({ connectionString: urlFor('postgres'), maxConnections: 1 });
  for (const name of [CLEAN, MISMATCHED]) {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  }

  clean = createDatabase({ connectionString: urlFor(CLEAN), maxConnections: 1 });
  mismatched = createDatabase({ connectionString: urlFor(MISMATCHED), maxConnections: 1 });

  // 0020 までを適用し、契約と整合する配属を保存してから 0021 を適用する。
  await migrate(clean, await migrationsUpTo(LAST_VERSION_BEFORE_SCOPING));
  cleanFixture = await createFixture(clean, 'default');
  await assignBeforeScoping(clean, cleanFixture, {
    employeeId: cleanFixture.employerEmployeeId,
    workplaceSiteId: cleanFixture.hostSiteId,
    startsOn: '2026-04-01',
    endsOn: '2026-04-30',
  });
  await migrate(clean);

  // 受入組織の従業員を雇用元の契約へ配属したまま 0021 を迎える環境。
  await migrate(mismatched, await migrationsUpTo(LAST_VERSION_BEFORE_SCOPING));
  const fixture = await createFixture(mismatched, 'default');
  await assignBeforeScoping(mismatched, fixture, {
    employeeId: fixture.hostEmployeeId,
    startsOn: '2026-04-01',
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

describe('契約と整合しているデータベース', () => {
  it('保存されていた配属をそのまま残し、契約の組織を複製する', async () => {
    const rows = await clean.query<{
      employer_organization_id: string;
      host_organization_id: string;
      workplace_site_id: string | null;
    }>(
      `SELECT employer_organization_id, host_organization_id, workplace_site_id
         FROM employee_assignments`,
    );

    expect(rows[0]).toEqual({
      employer_organization_id: cleanFixture.employerId,
      host_organization_id: cleanFixture.hostId,
      workplace_site_id: cleanFixture.hostSiteId,
    });
  });

  it('雇用元に所属していない従業員は配属できない', async () => {
    await expect(
      assign(clean, cleanFixture, {
        employeeId: cleanFixture.hostEmployeeId,
        startsOn: '2026-06-01',
      }),
    ).rejects.toThrow(/employee_assignments_employee_fkey/);
  });

  it('受入組織にない拠点は勤務拠点にできない', async () => {
    await expect(
      assign(clean, cleanFixture, {
        employeeId: cleanFixture.employerEmployeeId,
        workplaceSiteId: cleanFixture.employerSiteId,
        startsOn: '2026-06-01',
      }),
    ).rejects.toThrow(/employee_assignments_site_fkey/);
  });

  it('期間が重なる配属は登録できない', async () => {
    await expect(
      assign(clean, cleanFixture, {
        employeeId: cleanFixture.employerEmployeeId,
        startsOn: '2026-04-15',
      }),
    ).rejects.toThrow(/employee_assignments_no_overlap/);
  });

  it('重ならない期間なら登録できる', async () => {
    await expect(
      assign(clean, cleanFixture, {
        employeeId: cleanFixture.employerEmployeeId,
        workplaceSiteId: cleanFixture.hostSiteId,
        startsOn: '2026-05-01',
      }),
    ).resolves.toBeUndefined();
  });

  it('契約の組織だけを書き換えられない', async () => {
    await expect(
      clean.query('UPDATE employee_assignments SET host_organization_id = $1', [
        cleanFixture.employerId,
      ]),
    ).rejects.toThrow(/employee_assignments_contract_host_fkey/);
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(clean);

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('契約と食い違う配属が残っているデータベース', () => {
  it('該当する配属を示して適用を止める', async () => {
    await expect(migrate(mismatched)).rejects.toThrow(/配属に整合しない組み合わせが残っています/);
  });

  it('止まった時点では列を残さない', async () => {
    const rows = await mismatched.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_name = 'employee_assignments' AND column_name = 'host_organization_id'`,
    );

    expect(rows[0]?.count).toBe(0);
  });

  it('配属を直せば適用できる', async () => {
    await mismatched.query('DELETE FROM employee_assignments');

    // 後から足した版も一緒に適用されるため、この移行が通ったことだけを見る。
    await expect(migrate(mismatched)).resolves.toEqual(
      expect.objectContaining({ appliedVersions: expect.arrayContaining([21]) }),
    );
  });
});
