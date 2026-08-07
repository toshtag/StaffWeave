/**
 * 申請まわりの通知。
 *
 * ここで固定したいのは 4 つ。
 *
 *   申請・承認・差し戻し・取消・代理承認が、それぞれの相手へ届くこと
 *   自分の操作の通知が、自分へ返ってこないこと
 *   同じ出来事から二度積まないこと
 *   他人の通知を読めず、既読にもできないこと
 */
import type {
  EmployeeRequestRecord,
  NotificationList,
  RequestTypeRecord,
} from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createTestApp,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

const app = (): TestApp => createTestApp();

interface Fixture {
  workspaceId: string;
  employeeId: string;
  adminCookie: string;
  managerCookie: string;
  managerUserId: string;
  adminUserId: string;
  employeeCookie: string;
  outsiderCookie: string;
}

let fixture: Fixture;

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  const branchId = await createOrganization(db, workspaceId, { code: 'BR' });

  const admin = await createUser(db, workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const manager = await createUser(db, workspaceId, {
    email: 'manager@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: manager, organizationId });

  // 支社しか見られない承認者。本社の申請の通知は届かない。
  const outsider = await createUser(db, workspaceId, {
    email: 'outsider@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, {
    userId: outsider,
    organizationId: branchId,
  });

  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '申請 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  return {
    workspaceId,
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    managerCookie: await loginAndGetCookie(instance, { email: 'manager@example.com' }),
    managerUserId: manager,
    adminUserId: admin,
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    outsiderCookie: await loginAndGetCookie(instance, { email: 'outsider@example.com' }),
  };
}

beforeEach(async () => {
  fixture = await setUp();
});

async function createType(instance: TestApp): Promise<RequestTypeRecord> {
  const response = await instance.request(
    '/api/request-types',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { code: 'OT', name: '残業', category: 'other', approvalSteps: 1 },
    }),
  );
  if (response.status !== 201) throw new Error(`申請種別を作れませんでした: ${response.status}`);
  return (await response.json()) as RequestTypeRecord;
}

async function submit(instance: TestApp, type: RequestTypeRecord): Promise<EmployeeRequestRecord> {
  const response = await instance.request(
    '/api/employee-requests',
    authorized(fixture.employeeCookie, {
      method: 'POST',
      body: {
        requestTypeId: type.id,
        employeeId: fixture.employeeId,
        businessDate: '2026-04-10',
        reason: '対応のため',
      },
    }),
  );
  if (response.status !== 201) throw new Error(`申請できませんでした: ${response.status}`);
  return (await response.json()) as EmployeeRequestRecord;
}

async function inbox(instance: TestApp, cookie: string): Promise<NotificationList> {
  const response = await instance.request('/api/notifications', authorized(cookie));
  if (response.status !== 200) throw new Error(`通知を読めませんでした: ${response.status}`);
  return (await response.json()) as NotificationList;
}

describe('申請の通知', () => {
  it('申請すると、決裁できる相手へ届く', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    const forManager = await inbox(instance, fixture.managerCookie);
    const forAdmin = await inbox(instance, fixture.adminCookie);

    expect(forManager.unreadCount).toBe(1);
    expect(forManager.notifications[0]).toMatchObject({
      kind: 'request_submitted',
      readAt: null,
    });
    expect(forAdmin.unreadCount).toBe(1);
  });

  it('範囲の外の承認者へは届かない', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    expect((await inbox(instance, fixture.outsiderCookie)).unreadCount).toBe(0);
  });

  it('自分の操作の通知は、自分へ返ってこない', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    // 申請したのは従業員本人。本人あての通知はまだ無い。
    expect((await inbox(instance, fixture.employeeCookie)).unreadCount).toBe(0);
  });

  it('承認すると、申請した本人へ届く', async () => {
    const instance = app();
    const type = await createType(instance);
    const request = await submit(instance, type);

    await instance.request(
      `/api/employee-requests/${request.id}/decisions`,
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { decision: 'approved', step: 1, submission: 1 },
      }),
    );

    const forEmployee = await inbox(instance, fixture.employeeCookie);
    expect(forEmployee.notifications[0]).toMatchObject({ kind: 'request_approved' });
  });

  it('差し戻すと、申請した本人へ届く', async () => {
    const instance = app();
    const type = await createType(instance);
    const request = await submit(instance, type);

    await instance.request(
      `/api/employee-requests/${request.id}/decisions`,
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { decision: 'returned', step: 1, submission: 1, comment: '直してください' },
      }),
    );

    const forEmployee = await inbox(instance, fixture.employeeCookie);
    expect(forEmployee.notifications[0]).toMatchObject({ kind: 'request_returned' });
  });

  it('代理で決裁すると、本来の承認者へ届く', async () => {
    const instance = app();
    const type = await createType(instance);

    // 代理は、任された記録があるときだけ通る。経路と委任を先に置く。
    const route = await instance.request(
      `/api/request-types/${type.id}/approval-route`,
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          steps: [{ step: 1, approverUserId: fixture.managerUserId, approverPolicy: 'user' }],
        },
      }),
    );
    expect(route.status).toBe(200);

    const delegation = await instance.request(
      '/api/approval-delegations',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          fromUserId: fixture.managerUserId,
          toUserId: fixture.adminUserId,
          effectiveFrom: '2026-01-01',
        },
      }),
    );
    expect(delegation.status).toBe(201);

    const request = await submit(instance, type);

    await instance.request(
      `/api/employee-requests/${request.id}/decisions`,
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          decision: 'approved',
          step: 1,
          submission: 1,
          onBehalfOfUserId: fixture.managerUserId,
        },
      }),
    );

    const forManager = await inbox(instance, fixture.managerCookie);
    expect(forManager.notifications.map((entry) => entry.kind)).toContain(
      'request_decided_on_behalf',
    );
  });

  it('取り下げると、決裁を待っていた相手へ届く', async () => {
    const instance = app();
    const type = await createType(instance);
    const request = await submit(instance, type);

    await instance.request(
      `/api/employee-requests/${request.id}/cancellation`,
      authorized(fixture.employeeCookie, { method: 'POST' }),
    );

    const forAdmin = await inbox(instance, fixture.adminCookie);
    expect(forAdmin.notifications.map((entry) => entry.kind)).toContain('request_cancelled');
  });

  it('出し直すと、もう一度決裁できる相手へ届く', async () => {
    const instance = app();
    const type = await createType(instance);
    const request = await submit(instance, type);

    await instance.request(
      `/api/employee-requests/${request.id}/decisions`,
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { decision: 'returned', step: 1, submission: 1, comment: '直してください' },
      }),
    );
    await instance.request(
      `/api/employee-requests/${request.id}/resubmissions`,
      authorized(fixture.employeeCookie, { method: 'POST', body: { reason: '直しました' } }),
    );

    const forAdmin = await inbox(instance, fixture.adminCookie);
    // 1 回目の提出と、出し直しの 2 件。
    expect(
      forAdmin.notifications.filter((entry) => entry.kind === 'request_submitted'),
    ).toHaveLength(2);
  });

  it('同じ決裁を送り直しても、通知は増えない', async () => {
    const instance = app();
    const type = await createType(instance);
    const request = await submit(instance, type);

    for (const _ of [1, 2]) {
      await instance.request(
        `/api/employee-requests/${request.id}/decisions`,
        authorized(fixture.adminCookie, {
          method: 'POST',
          body: { decision: 'approved', step: 1, submission: 1 },
        }),
      );
    }

    const forEmployee = await inbox(instance, fixture.employeeCookie);
    expect(
      forEmployee.notifications.filter((entry) => entry.kind === 'request_approved'),
    ).toHaveLength(1);
  });
});

describe('通知の読み取り', () => {
  it('既読にすると、未読の件数が減る', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    const before = await inbox(instance, fixture.adminCookie);
    const id = before.notifications[0]?.id;
    if (id === undefined) throw new Error('通知がありません');

    const response = await instance.request(
      '/api/notifications/read',
      authorized(fixture.adminCookie, { method: 'POST', body: { ids: [id] } }),
    );

    expect(await response.json()).toEqual({ read: 1, unreadCount: 0 });
  });

  it('二度既読にしても、件数は狂わない', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    const before = await inbox(instance, fixture.adminCookie);
    const id = before.notifications[0]?.id;
    if (id === undefined) throw new Error('通知がありません');

    await instance.request(
      '/api/notifications/read',
      authorized(fixture.adminCookie, { method: 'POST', body: { ids: [id] } }),
    );
    const second = await instance.request(
      '/api/notifications/read',
      authorized(fixture.adminCookie, { method: 'POST', body: { ids: [id] } }),
    );

    expect(await second.json()).toEqual({ read: 0, unreadCount: 0 });
  });

  it('他人の通知は読めず、既読にもできない', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    const forAdmin = await inbox(instance, fixture.adminCookie);
    const id = forAdmin.notifications[0]?.id;
    if (id === undefined) throw new Error('通知がありません');

    // 別の利用者の一覧には現れない。
    const forEmployee = await inbox(instance, fixture.employeeCookie);
    expect(forEmployee.notifications.map((entry) => entry.id)).not.toContain(id);

    // 識別子を渡しても、その行は動かない。
    const response = await instance.request(
      '/api/notifications/read',
      authorized(fixture.employeeCookie, { method: 'POST', body: { ids: [id] } }),
    );
    expect(await response.json()).toEqual({ read: 0, unreadCount: 0 });
    expect((await inbox(instance, fixture.adminCookie)).unreadCount).toBe(1);
  });

  it('未読だけを絞り込める', async () => {
    const instance = app();
    const type = await createType(instance);
    await submit(instance, type);

    const before = await inbox(instance, fixture.adminCookie);
    const id = before.notifications[0]?.id;
    if (id === undefined) throw new Error('通知がありません');
    await instance.request(
      '/api/notifications/read',
      authorized(fixture.adminCookie, { method: 'POST', body: { ids: [id] } }),
    );

    const response = await instance.request(
      '/api/notifications?unreadOnly=true',
      authorized(fixture.adminCookie),
    );
    const { notifications } = (await response.json()) as NotificationList;

    expect(notifications).toEqual([]);
  });
});
