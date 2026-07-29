import type { Employee, Organization, OrganizationList, Site } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import {
  authorized,
  createOrganization,
  createUser,
  createWorkspace,
  login,
  loginAndGetCookie,
} from '../support/fixtures.js';

function app() {
  return createApp({ db: testDatabase(), defaultWorkspaceSlug: 'default' });
}

describe('組織構造の管理', () => {
  let workspaceId: string;
  let adminCookie: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
    adminCookie = await loginAndGetCookie(app(), { email: 'admin@example.com' });
  });

  it('組織を登録して一覧できる', async () => {
    const instance = app();
    const created = await instance.request(
      '/api/organizations',
      authorized(adminCookie, { method: 'POST', body: { code: 'hq', name: '本社' } }),
    );
    const organization = (await created.json()) as Organization;

    expect(created.status).toBe(201);
    // コードは大文字へ正規化し、表記ゆれで重複登録されないようにする。
    expect(organization.code).toBe('HQ');

    const listed = await instance.request('/api/organizations', authorized(adminCookie));
    expect(((await listed.json()) as OrganizationList).organizations).toHaveLength(1);
  });

  it('同じコードの組織は登録できない', async () => {
    const instance = app();
    await instance.request(
      '/api/organizations',
      authorized(adminCookie, { method: 'POST', body: { code: 'HQ', name: '本社' } }),
    );
    const duplicate = await instance.request(
      '/api/organizations',
      authorized(adminCookie, { method: 'POST', body: { code: 'hq', name: '本社（重複）' } }),
    );

    expect(duplicate.status).toBe(409);
  });

  it('コードの形式が不正なら 400 を返す', async () => {
    const response = await app().request(
      '/api/organizations',
      authorized(adminCookie, { method: 'POST', body: { code: '本社', name: '本社' } }),
    );
    expect(response.status).toBe(400);
  });

  it('拠点は組織へ属し、タイムゾーンを省略するとワークスペースの値を引き継ぐ', async () => {
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    const response = await app().request(
      '/api/sites',
      authorized(adminCookie, {
        method: 'POST',
        body: { organizationId, code: 'TOKYO', name: '東京オフィス' },
      }),
    );
    const site = (await response.json()) as Site;

    expect(response.status).toBe(201);
    expect(site.timeZone).toBe('Asia/Tokyo');
  });

  it('部門は親子関係を持てる', async () => {
    const instance = app();
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });

    const parent = await instance.request(
      '/api/departments',
      authorized(adminCookie, {
        method: 'POST',
        body: { organizationId, code: 'SALES', name: '営業本部' },
      }),
    );
    const parentBody = (await parent.json()) as { id: string };

    const child = await instance.request(
      '/api/departments',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          organizationId,
          parentDepartmentId: parentBody.id,
          code: 'SALES1',
          name: '第一営業部',
        },
      }),
    );

    expect(child.status).toBe(201);
    expect(((await child.json()) as { parentDepartmentId: string }).parentDepartmentId).toBe(
      parentBody.id,
    );
  });
});

describe('権限', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    await createUser(testDatabase(), workspaceId, {
      email: 'manager@example.com',
      roles: ['organization_manager'],
    });
    await createUser(testDatabase(), workspaceId, {
      email: 'member@example.com',
      roles: ['employee'],
    });
  });

  it('組織管理者は閲覧できるが登録はできない', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'manager@example.com' });

    expect((await instance.request('/api/organizations', authorized(cookie))).status).toBe(200);
    expect(
      (
        await instance.request(
          '/api/organizations',
          authorized(cookie, { method: 'POST', body: { code: 'HQ', name: '本社' } }),
        )
      ).status,
    ).toBe(403);
  });

  it('従業員ロールは組織構造を閲覧できない', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'member@example.com' });

    expect((await instance.request('/api/organizations', authorized(cookie))).status).toBe(403);
    expect((await instance.request('/api/employees', authorized(cookie))).status).toBe(403);
  });

  it('未認証では 401 を返す', async () => {
    expect((await app().request('/api/organizations')).status).toBe(401);
  });
});

describe('ワークスペース境界（組織構造）', () => {
  let firstWorkspaceId: string;
  let secondWorkspaceId: string;
  let firstAdminCookie: string;

  beforeEach(async () => {
    firstWorkspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    secondWorkspaceId = await createWorkspace(testDatabase(), { slug: 'other' });

    await createUser(testDatabase(), firstWorkspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), secondWorkspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });

    await createOrganization(testDatabase(), firstWorkspaceId, { code: 'FIRST' });
    await createOrganization(testDatabase(), secondWorkspaceId, { code: 'SECOND' });

    firstAdminCookie = await loginAndGetCookie(app(), { email: 'admin@example.com' });
  });

  it('自分のワークスペースの組織だけが見える', async () => {
    const response = await app().request('/api/organizations', authorized(firstAdminCookie));
    const body = (await response.json()) as OrganizationList;

    expect(body.organizations.map((organization) => organization.code)).toEqual(['FIRST']);
  });

  it('別ワークスペースの組織を指定した拠点は登録できない', async () => {
    const rows = await testDatabase().query<{ id: string }>(
      'SELECT id FROM organizations WHERE workspace_id = $1',
      [secondWorkspaceId],
    );
    const foreignOrganizationId = rows[0]?.id;
    expect(foreignOrganizationId).toBeDefined();

    const response = await app().request(
      '/api/sites',
      authorized(firstAdminCookie, {
        method: 'POST',
        body: { organizationId: foreignOrganizationId, code: 'TOKYO', name: '東京' },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('別ワークスペースの管理者は相手の組織を見られない', async () => {
    const otherCookie = await loginAndGetCookie(app(), {
      email: 'admin@example.com',
      workspaceSlug: 'other',
    });
    const response = await app().request('/api/organizations', authorized(otherCookie));
    const body = (await response.json()) as OrganizationList;

    expect(body.organizations.map((organization) => organization.code)).toEqual(['SECOND']);
  });
});

describe('従業員の登録', () => {
  let workspaceId: string;
  let organizationId: string;
  let adminCookie: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
    adminCookie = await loginAndGetCookie(app(), { email: 'admin@example.com' });
  });

  it('ログイン用の利用者を伴う従業員を登録できる', async () => {
    const instance = app();
    const response = await instance.request(
      '/api/employees',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          organizationId,
          employeeNumber: 'e001',
          displayName: '勤怠 花子',
          hiredOn: '2026-04-01',
          account: {
            email: 'hanako@example.com',
            password: 'staffweave test pass',
            roles: ['employee'],
          },
        },
      }),
    );
    const employee = (await response.json()) as Employee;

    expect(response.status).toBe(201);
    expect(employee.employeeNumber).toBe('E001');
    expect(employee.userId).not.toBeNull();

    const session = await login(instance, { email: 'hanako@example.com' });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { employee: { displayName: string } | null };
    expect(body.employee?.displayName).toBe('勤怠 花子');
  });

  it('利用者を伴わない従業員も登録できる', async () => {
    const response = await app().request(
      '/api/employees',
      authorized(adminCookie, {
        method: 'POST',
        body: { organizationId, employeeNumber: 'E002', displayName: '打刻 次郎' },
      }),
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as Employee).userId).toBeNull();
  });

  it('同じ従業員番号は登録できない', async () => {
    const instance = app();
    const body = { organizationId, employeeNumber: 'E003', displayName: '重複 三郎' };
    await instance.request('/api/employees', authorized(adminCookie, { method: 'POST', body }));
    const duplicate = await instance.request(
      '/api/employees',
      authorized(adminCookie, { method: 'POST', body }),
    );

    expect(duplicate.status).toBe(409);
  });

  it('既存のメールアドレスでは利用者を作れず、従業員も登録されない', async () => {
    const instance = app();
    const response = await instance.request(
      '/api/employees',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          organizationId,
          employeeNumber: 'E004',
          displayName: '重複 四郎',
          account: { email: 'admin@example.com', password: 'staffweave test pass' },
        },
      }),
    );

    expect(response.status).toBe(409);

    // トランザクションが巻き戻り、従業員も残っていないこと。
    const rows = await testDatabase().query<{ count: number }>(
      "SELECT count(*)::int AS count FROM employees WHERE employee_number = 'E004'",
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('短すぎるパスワードは拒否する', async () => {
    const response = await app().request(
      '/api/employees',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          organizationId,
          employeeNumber: 'E005',
          displayName: '短い 五郎',
          account: { email: 'goro@example.com', password: 'short' },
        },
      }),
    );

    expect(response.status).toBe(400);
  });
});
