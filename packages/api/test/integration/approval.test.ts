import type {
  DailyRequestList,
  DailyRequestRecord,
  MonthlyClosingRecord,
  WorkDay,
} from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
} from '../support/fixtures.js';

/** Asia/Tokyo で 2026-04-01 の 09:00 と 18:00 にあたる絶対時刻。 */
const CLOCK_IN_AT = '2026-04-01T00:00:00.000Z';
const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z';
const BUSINESS_DATE = '2026-04-01';
const PERIOD = '2026-04-01';

function app(now: string = CLOCK_OUT_AT) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(now),
  });
}

type App = ReturnType<typeof app>;

interface Fixture {
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
  approverCookie: string;
}

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  await createUser(testDatabase(), workspaceId, {
    email: 'approver@example.com',
    roles: ['organization_manager'],
  });
  const { employeeId } = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  return {
    employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    approverCookie: await loginAndGetCookie(instance, { email: 'approver@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
}

async function punchWholeDay(instance: App, cookie: string, suffix: string): Promise<void> {
  await instance.request(
    '/api/attendance/events',
    authorized(cookie, {
      method: 'POST',
      body: { eventType: 'clock_in', requestId: `in-${suffix}`, occurredAt: CLOCK_IN_AT },
    }),
  );
  await instance.request(
    '/api/attendance/events',
    authorized(cookie, {
      method: 'POST',
      body: { eventType: 'clock_out', requestId: `out-${suffix}`, occurredAt: CLOCK_OUT_AT },
    }),
  );
}

async function submit(
  instance: App,
  cookie: string,
  comment?: string,
): Promise<{ status: number; request: DailyRequestRecord }> {
  const response = await instance.request(
    '/api/attendance/requests',
    authorized(cookie, {
      method: 'POST',
      body: { businessDate: BUSINESS_DATE, ...(comment === undefined ? {} : { comment }) },
    }),
  );
  return { status: response.status, request: (await response.json()) as DailyRequestRecord };
}

async function day(instance: App, cookie: string): Promise<WorkDay> {
  const response = await instance.request(
    `/api/attendance/days/${BUSINESS_DATE}`,
    authorized(cookie),
  );
  return (await response.json()) as WorkDay;
}

describe('日次申請', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await punchWholeDay(app(), fixture.employeeCookie, 'base-request');
  });

  it('申請すると申請中になる', async () => {
    const { status, request } = await submit(app(), fixture.employeeCookie, '確認をお願いします');

    expect(status).toBe(200);
    expect(request.state).toBe('submitted');
    expect(request.submissions).toBe(1);
    expect(request.transitions).toHaveLength(1);
    expect(request.transitions[0]?.comment).toBe('確認をお願いします');
  });

  it('承認者が承認できる', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);

    const response = await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: { comment: '確認しました' } }),
    );
    const approved = (await response.json()) as DailyRequestRecord;

    expect(response.status).toBe(200);
    expect(approved.state).toBe('approved');
    expect(approved.decidedByUserId).not.toBeNull();
    expect(approved.transitions.map((transition) => transition.event)).toEqual([
      'SUBMIT',
      'APPROVE',
    ]);
  });

  it('差し戻すと再提出できる', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);

    const returned = await instance.request(
      `/api/attendance/requests/${request.id}/return`,
      authorized(fixture.approverCookie, {
        method: 'POST',
        body: { comment: '休憩の記録が抜けています' },
      }),
    );
    expect(((await returned.json()) as DailyRequestRecord).state).toBe('returned');

    const resubmitted = await submit(instance, fixture.employeeCookie);
    expect(resubmitted.request.state).toBe('submitted');
    expect(resubmitted.request.submissions).toBe(2);
    expect(resubmitted.request.returns).toBe(1);
  });

  it('差し戻しには理由が必要', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);

    const response = await instance.request(
      `/api/attendance/requests/${request.id}/return`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(400);
  });

  it('本人は自分の申請を取り消せる', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);

    const response = await instance.request(
      `/api/attendance/requests/${request.id}/cancel`,
      authorized(fixture.employeeCookie, { method: 'POST', body: {} }),
    );

    expect(((await response.json()) as DailyRequestRecord).state).toBe('cancelled');
  });

  it('承認済みの申請は取り消せない', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );

    const response = await instance.request(
      `/api/attendance/requests/${request.id}/cancel`,
      authorized(fixture.employeeCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(409);
  });

  it('承認権限がなければ承認できない', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);

    const response = await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.employeeCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(403);
  });

  it('存在しない申請は 404 を返す', async () => {
    const response = await app().request(
      '/api/attendance/requests/00000000-0000-4000-8000-000000000000/approve',
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );
    expect(response.status).toBe(404);
  });

  it('承認済みを重ねて承認できない', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );

    const response = await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );

    expect(response.status).toBe(409);
  });

  it('期間を指定して一覧できる', async () => {
    const instance = app();
    await submit(instance, fixture.employeeCookie);

    const response = await instance.request(
      '/api/attendance/requests?from=2026-04-01&to=2026-04-30&state=submitted',
      authorized(fixture.approverCookie),
    );

    expect(((await response.json()) as DailyRequestList).requests).toHaveLength(1);
  });

  it('従業員は他人の申請を一覧できない', async () => {
    const response = await app().request(
      `/api/attendance/requests?employeeId=00000000-0000-4000-8000-000000000000&from=2026-04-01&to=2026-04-30`,
      authorized(fixture.employeeCookie),
    );
    expect(response.status).toBe(403);
  });
});

describe('確定後の編集制御', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await punchWholeDay(app(), fixture.employeeCookie, 'editing-lock');
  });

  it('申請中は打刻を修正できない', async () => {
    const instance = app();
    const before = await day(instance, fixture.employeeCookie);
    expect(before.editable).toBe(true);

    await submit(instance, fixture.employeeCookie);

    const after = await day(instance, fixture.employeeCookie);
    expect(after.editable).toBe(false);
    expect(after.request?.state).toBe('submitted');

    const response = await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'void',
          targetEventId: before.events[0]?.id,
          reason: '締め後の変更を試す',
          requestId: 'locked-correction',
        },
      }),
    );

    expect(response.status).toBe(409);
  });

  it('差し戻されれば再び修正できる', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);
    await instance.request(
      `/api/attendance/requests/${request.id}/return`,
      authorized(fixture.approverCookie, { method: 'POST', body: { comment: '直してください' } }),
    );

    expect((await day(instance, fixture.employeeCookie)).editable).toBe(true);
  });

  it('承認済みは打刻を追加できない', async () => {
    const instance = app();
    const { request } = await submit(instance, fixture.employeeCookie);
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );

    const response = await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'add',
          eventType: 'break_start',
          occurredAt: CLOCK_IN_AT,
          businessDate: BUSINESS_DATE,
          reason: '承認後の追加を試す',
          requestId: 'approved-correction',
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '承認済み',
    );
  });
});

describe('月次締め', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await punchWholeDay(app(), fixture.employeeCookie, 'closing');
  });

  async function approveDay(instance: App): Promise<void> {
    const { request } = await submit(instance, fixture.employeeCookie);
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );
  }

  it('すべて承認済みなら締められる', async () => {
    const instance = app();
    await approveDay(instance);

    const response = await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );
    const closing = (await response.json()) as MonthlyClosingRecord;

    expect(response.status).toBe(200);
    expect(closing.state).toBe('closed');
    expect(closing.closedAt).not.toBeNull();
  });

  it('未承認の日が残っていれば締められない', async () => {
    const response = await app().request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '承認されていない',
    );
  });

  it('締めた月は打刻できない', async () => {
    const instance = app();
    await approveDay(instance);
    await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );

    const target = await day(instance, fixture.employeeCookie);
    expect(target.editable).toBe(false);
    expect(target.closing?.state).toBe('closed');

    const response = await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'void',
          targetEventId: target.events[0]?.id,
          reason: '締め後の変更を試す',
          requestId: 'closed-correction',
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '締められている',
    );
  });

  it('締めた月へは申請できない', async () => {
    const instance = app();
    await approveDay(instance);
    await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );

    const response = await instance.request(
      '/api/attendance/requests',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { businessDate: BUSINESS_DATE },
      }),
    );

    expect(response.status).toBe(409);
  });

  it('締めを解除すると承認済みの申請が差し戻しへ戻る', async () => {
    const instance = app();
    await approveDay(instance);
    await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );

    const response = await instance.request(
      '/api/monthly-closings/reopen',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          period: PERIOD,
          reason: '打刻の誤りが見つかったため',
        },
      }),
    );
    const closing = (await response.json()) as MonthlyClosingRecord;

    expect(closing.state).toBe('open');
    expect(closing.reopens).toBe(1);
    expect(closing.reopenReason).toBe('打刻の誤りが見つかったため');

    const target = await day(instance, fixture.employeeCookie);
    expect(target.request?.state).toBe('returned');
    expect(target.editable).toBe(true);
    expect(target.request?.transitions.map((transition) => transition.event)).toEqual([
      'SUBMIT',
      'APPROVE',
      'REOPEN',
    ]);
  });

  it('締めていない月は解除できない', async () => {
    const response = await app().request(
      '/api/monthly-closings/reopen',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD, reason: '確認のため' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('解除には理由が必要', async () => {
    const response = await app().request(
      '/api/monthly-closings/reopen',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD, reason: '' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('締め権限がなければ締められない', async () => {
    const instance = app();
    await approveDay(instance);

    const response = await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.approverCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('二重に締められない', async () => {
    const instance = app();
    await approveDay(instance);
    const body = { employeeId: fixture.employeeId, period: PERIOD };
    await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );
    const duplicate = await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );

    expect(duplicate.status).toBe(409);
  });
});
