import type {
  AssignmentContractRecord,
  DailyRequestList,
  DailyRequestRecord,
  EmployeeAssignmentRecord,
  EmployeeList,
  SessionResponse,
} from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
  testAppFactory,
} from '../support/fixtures.js';

const BUSINESS_DATE = '2026-04-01';

const app = testAppFactory({ now: '2026-04-01T09:00:00.000Z' });

type App = TestApp;

interface Fixture {
  workspaceId: string;
  employerOrganizationId: string;
  hostOrganizationId: string;
  adminCookie: string;
  /** 雇用元の従業員。受入組織へ配属される。 */
  dispatchedEmployeeId: string;
  dispatchedCookie: string;
  /** 受入組織とは無関係な従業員。 */
  internalEmployeeId: string;
  internalCookie: string;
  hostApproverUserId: string;
}

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const employerOrganizationId = await createOrganization(db, workspaceId, { code: 'EMPLOYER' });
  const hostOrganizationId = await createOrganization(db, workspaceId, { code: 'HOST' });

  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });

  // 受入組織側の承認者（外部承認者）。閲覧範囲は後から与える。
  const hostApproverUserId = await createUser(db, workspaceId, {
    email: 'host-approver@example.com',
    roles: ['organization_manager'],
  });

  const dispatched = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: employerOrganizationId,
    employeeNumber: 'E001',
    displayName: '派遣 花子',
    email: 'hanako@example.com',
  });
  const internal = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: employerOrganizationId,
    employeeNumber: 'E002',
    displayName: '社内 次郎',
    email: 'jiro@example.com',
  });

  const instance = app();
  return {
    workspaceId,
    employerOrganizationId,
    hostOrganizationId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    dispatchedEmployeeId: dispatched.employeeId,
    dispatchedCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    internalEmployeeId: internal.employeeId,
    internalCookie: await loginAndGetCookie(instance, { email: 'jiro@example.com' }),
    hostApproverUserId,
  };
}

async function createContract(
  instance: App,
  fixture: Fixture,
  body: Record<string, unknown> = {},
): Promise<AssignmentContractRecord> {
  const response = await instance.request(
    '/api/assignment-contracts',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: {
        code: 'C001',
        name: '受入契約',
        employerOrganizationId: fixture.employerOrganizationId,
        hostOrganizationId: fixture.hostOrganizationId,
        startsOn: '2026-04-01',
        ...body,
      },
    }),
  );
  return (await response.json()) as AssignmentContractRecord;
}

async function assign(
  instance: App,
  fixture: Fixture,
  body: { assignmentContractId: string; startsOn: string; endsOn?: string },
): Promise<EmployeeAssignmentRecord> {
  const response = await instance.request(
    '/api/employee-assignments',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { employeeId: fixture.dispatchedEmployeeId, ...body },
    }),
  );
  return (await response.json()) as EmployeeAssignmentRecord;
}

describe('契約と配属', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('雇用元と受入組織の契約を登録できる', async () => {
    const contract = await createContract(app(), fixture);

    expect(contract.code).toBe('C001');
    expect(contract.employerOrganizationId).toBe(fixture.employerOrganizationId);
    expect(contract.hostOrganizationId).toBe(fixture.hostOrganizationId);
    expect(contract.endsOn).toBeNull();
  });

  it('契約期間が逆転していれば受け付けない', async () => {
    const response = await app().request(
      '/api/assignment-contracts',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          code: 'C002',
          name: '不正な契約',
          employerOrganizationId: fixture.employerOrganizationId,
          hostOrganizationId: fixture.hostOrganizationId,
          startsOn: '2026-04-30',
          endsOn: '2026-04-01',
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('従業員を勤務先へ配属できる', async () => {
    const instance = app();
    const contract = await createContract(instance, fixture);

    const response = await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          startsOn: '2026-04-01',
        },
      }),
    );
    const assignment = (await response.json()) as EmployeeAssignmentRecord;

    expect(response.status).toBe(201);
    expect(assignment.employeeId).toBe(fixture.dispatchedEmployeeId);
  });

  it('存在しない契約へは配属できない', async () => {
    const response = await app().request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: '00000000-0000-4000-8000-000000000000',
          startsOn: '2026-04-01',
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('雇用元に所属していない従業員は配属できない', async () => {
    const instance = app();
    // 受入組織に所属する従業員は、この契約の雇用元の従業員ではない。
    const outsider = await createEmployeeWithAccount(testDatabase(), fixture.workspaceId, {
      organizationId: fixture.hostOrganizationId,
      employeeNumber: 'E003',
      displayName: '受入 三郎',
      email: 'saburo@example.com',
    });
    const contract = await createContract(instance, fixture);

    const response = await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: outsider.employeeId,
          assignmentContractId: contract.id,
          startsOn: '2026-04-01',
        },
      }),
    );

    expect(response.status).toBe(400);

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM employee_assignments',
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('受入組織にない拠点は勤務拠点にできない', async () => {
    const instance = app();
    const contract = await createContract(instance, fixture);
    // 雇用元の拠点。受入組織の拠点ではない。
    const site = await instance.request(
      '/api/sites',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          organizationId: fixture.employerOrganizationId,
          code: 'EMPLOYER1',
          name: '雇用元の事務所',
        },
      }),
    );
    const siteId = ((await site.json()) as { id: string }).id;

    const response = await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          workplaceSiteId: siteId,
          startsOn: '2026-04-01',
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('受入組織の拠点なら勤務拠点にできる', async () => {
    const instance = app();
    const contract = await createContract(instance, fixture);
    const site = await instance.request(
      '/api/sites',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { organizationId: fixture.hostOrganizationId, code: 'HOST1', name: '受入先の工場' },
      }),
    );
    const siteId = ((await site.json()) as { id: string }).id;

    const response = await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          workplaceSiteId: siteId,
          startsOn: '2026-04-01',
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as EmployeeAssignmentRecord).workplaceSiteId).toBe(siteId);
  });

  it('期間が重なる配属は受け付けない', async () => {
    const instance = app();
    const contract = await createContract(instance, fixture);
    await assign(instance, fixture, { assignmentContractId: contract.id, startsOn: '2026-04-01' });

    const response = await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          startsOn: '2026-05-01',
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '終了日を設定してください',
    );
  });

  it('前の配属へ終了日を設定してから次を配属できる', async () => {
    const instance = app();
    const contract = await createContract(instance, fixture);
    const first = await assign(instance, fixture, {
      assignmentContractId: contract.id,
      startsOn: '2026-04-01',
    });

    const ended = await instance.request(
      `/api/employee-assignments/${first.id}/end`,
      authorized(fixture.adminCookie, { method: 'POST', body: { endsOn: '2026-04-30' } }),
    );
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as EmployeeAssignmentRecord).endsOn).toBe('2026-04-30');

    const next = await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          startsOn: '2026-05-01',
        },
      }),
    );
    expect(next.status).toBe(201);
  });

  it('存在しない配属には終了日を設定できない', async () => {
    const response = await app().request(
      '/api/employee-assignments/00000000-0000-4000-8000-000000000000/end',
      authorized(fixture.adminCookie, { method: 'POST', body: { endsOn: '2026-04-30' } }),
    );

    expect(response.status).toBe(404);
  });

  it('従業員ロールは契約を登録できない', async () => {
    const response = await app().request(
      '/api/assignment-contracts',
      authorized(fixture.dispatchedCookie, {
        method: 'POST',
        body: {
          code: 'C003',
          name: '勝手な契約',
          employerOrganizationId: fixture.employerOrganizationId,
          hostOrganizationId: fixture.hostOrganizationId,
          startsOn: '2026-04-01',
        },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('勤務先別の閲覧権限', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    const instance = app();
    const contract = await createContract(instance, fixture);
    await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          startsOn: '2026-04-01',
        },
      }),
    );
    // 受入組織の承認者へ、その組織の閲覧範囲を与える。
    await instance.request(
      '/api/user-scopes',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          userId: fixture.hostApproverUserId,
          organizationId: fixture.hostOrganizationId,
        },
      }),
    );
  });

  it('閲覧範囲がセッションに現れる', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'host-approver@example.com' });
    const response = await instance.request('/api/auth/session', authorized(cookie));
    const body = (await response.json()) as SessionResponse;

    expect(body.user.organizationScopes).toEqual([fixture.hostOrganizationId]);
  });

  it('受入組織の承認者には配属された従業員だけが見える', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'host-approver@example.com' });

    const response = await instance.request('/api/employees', authorized(cookie));
    const body = (await response.json()) as EmployeeList;

    expect(body.employees.map((employee) => employee.employeeNumber)).toEqual(['E001']);
  });

  it('ワークスペース管理者は組織スコープがなくても全従業員を閲覧できる', async () => {
    const instance = app();

    // 全体を見られる根拠がロールであることを、この場で確かめる。
    const session = await instance.request('/api/auth/session', authorized(fixture.adminCookie));
    const user = ((await session.json()) as SessionResponse).user;
    expect(user.roles).toContain('workspace_admin');
    expect(user.organizationScopes).toEqual([]);

    const response = await instance.request('/api/employees', authorized(fixture.adminCookie));
    const body = (await response.json()) as EmployeeList;

    expect(body.employees).toHaveLength(2);
  });
});

describe('外部承認者による承認', () => {
  let fixture: Fixture;
  let hostApproverCookie: string;

  beforeEach(async () => {
    fixture = await setUp();
    const instance = app();
    const contract = await createContract(instance, fixture);
    await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.dispatchedEmployeeId,
          assignmentContractId: contract.id,
          startsOn: '2026-04-01',
        },
      }),
    );
    await instance.request(
      '/api/user-scopes',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          userId: fixture.hostApproverUserId,
          organizationId: fixture.hostOrganizationId,
        },
      }),
    );
    hostApproverCookie = await loginAndGetCookie(instance, {
      email: 'host-approver@example.com',
    });

    // 両方の従業員が打刻して申請する。
    for (const cookie of [fixture.dispatchedCookie, fixture.internalCookie]) {
      await instance.request(
        '/api/attendance/events',
        authorized(cookie, {
          method: 'POST',
          body: {
            eventType: 'clock_in',
            requestId: `clock-in-${cookie.slice(-8)}`,
            occurredAt: '2026-04-01T00:00:00.000Z',
          },
        }),
      );
      await instance.request(
        '/api/attendance/events',
        authorized(cookie, {
          method: 'POST',
          body: {
            eventType: 'clock_out',
            requestId: `clock-out-${cookie.slice(-8)}`,
            occurredAt: '2026-04-01T09:00:00.000Z',
          },
        }),
      );
      await instance.request(
        '/api/attendance/requests',
        authorized(cookie, { method: 'POST', body: { businessDate: BUSINESS_DATE } }),
      );
    }
  });

  it('配属された従業員の申請だけが承認対象に現れる', async () => {
    const response = await app().request(
      '/api/attendance/requests?from=2026-04-01&to=2026-04-30&state=submitted',
      authorized(hostApproverCookie),
    );
    const body = (await response.json()) as DailyRequestList;

    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]?.employeeId).toBe(fixture.dispatchedEmployeeId);
  });

  it('配属された従業員の申請を承認できる', async () => {
    const instance = app();
    const listed = await instance.request(
      '/api/attendance/requests?from=2026-04-01&to=2026-04-30&state=submitted',
      authorized(hostApproverCookie),
    );
    const request = ((await listed.json()) as DailyRequestList).requests[0];

    const response = await instance.request(
      `/api/attendance/requests/${request?.id}/approve`,
      authorized(hostApproverCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as DailyRequestRecord).state).toBe('approved');
  });

  it('範囲外の従業員の申請は承認できない', async () => {
    const instance = app();
    const listed = await instance.request(
      `/api/attendance/requests?employeeId=${fixture.internalEmployeeId}&from=2026-04-01&to=2026-04-30`,
      authorized(fixture.adminCookie),
    );
    const request = ((await listed.json()) as DailyRequestList).requests[0];

    const response = await instance.request(
      `/api/attendance/requests/${request?.id}/approve`,
      authorized(hostApproverCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(403);
  });

  it('範囲外の従業員を指定した一覧は拒否される', async () => {
    const response = await app().request(
      `/api/attendance/requests?employeeId=${fixture.internalEmployeeId}&from=2026-04-01&to=2026-04-30`,
      authorized(hostApproverCookie),
    );
    expect(response.status).toBe(403);
  });

  it('ワークスペース管理者は組織スコープがなくても対象申請を承認できる', async () => {
    const instance = app();

    const session = await instance.request('/api/auth/session', authorized(fixture.adminCookie));
    const user = ((await session.json()) as SessionResponse).user;
    expect(user.roles).toContain('workspace_admin');
    expect(user.organizationScopes).toEqual([]);

    const listed = await instance.request(
      `/api/attendance/requests?employeeId=${fixture.internalEmployeeId}&from=2026-04-01&to=2026-04-30`,
      authorized(fixture.adminCookie),
    );
    const request = ((await listed.json()) as DailyRequestList).requests[0];

    const response = await instance.request(
      `/api/attendance/requests/${request?.id}/approve`,
      authorized(fixture.adminCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(200);
  });
});
