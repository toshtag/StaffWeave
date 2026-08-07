/**
 * 月の日ごとの勤怠の一覧。
 *
 * 通常の画面は当日しか出せず、昨日以前を選ぶ導線が無かった。一覧を出すには、
 * 月ぶんの日を 1 回で読める経路が要る。1 日ずつ読むと、月を開くだけで
 * 日数ぶんの往復が起きる。
 *
 * ここで固定したいのは 3 つ。
 *
 *   打刻のある日と、計算のある日の両方が並ぶこと
 *   編集できるかどうかを、締めと申請の状態から返すこと
 *   閲覧できない相手の月は読めないこと
 */
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
const IN_AT = '2026-04-01T00:00:00.000Z';
const OUT_AT = '2026-04-01T09:00:00.000Z';

const app = testAppFactory({ now: '2026-04-01T14:00:00.000Z' });

interface Fixture {
  workspaceId: string;
  organizationId: string;
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '履歴 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  fixture = {
    workspaceId,
    organizationId,
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
});

async function punch(
  instance: TestApp,
  eventType: 'clock_in' | 'clock_out',
  occurredAt: string,
  requestId: string,
): Promise<void> {
  const response = await instance.request(
    '/api/attendance/events',
    authorized(fixture.employeeCookie, {
      method: 'POST',
      body: { eventType, requestId, occurredAt },
    }),
  );
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`打刻できませんでした: ${response.status} ${await response.text()}`);
  }
}

interface DayRow {
  businessDate: string;
  state: string;
  editable: boolean;
  workedMinutes: number | null;
  closingState: string | null;
}

async function days(instance: TestApp, query = ''): Promise<DayRow[]> {
  const response = await instance.request(
    `/api/attendance/days?period=2026-04-01${query}`,
    authorized(fixture.employeeCookie),
  );
  if (response.status !== 200) {
    throw new Error(`一覧を読めませんでした: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { days: DayRow[] }).days;
}

describe('月の日ごとの一覧', () => {
  it('打刻のある日が、状態と実労働つきで並ぶ', async () => {
    const instance = app();
    await punch(instance, 'clock_in', IN_AT, 'history-list-in');
    await punch(instance, 'clock_out', OUT_AT, 'history-list-out');

    const day = (await days(instance)).find((entry) => entry.businessDate === BUSINESS_DATE);

    expect(day?.state).toBe('finished');
    expect(day?.workedMinutes).toBe(9 * 60);
    expect(day?.editable).toBe(true);
  });

  it('打刻の無い月は、空の一覧を返す', async () => {
    const instance = app();

    expect(await days(instance)).toEqual([]);
  });

  it('締めた月は、編集できない日として返す', async () => {
    const instance = app();
    await punch(instance, 'clock_in', IN_AT, 'history-closed-in');
    await punch(instance, 'clock_out', OUT_AT, 'history-closed-out');

    // 締めるには、その日の申請が承認されている必要がある。
    const submitted = await instance.request(
      '/api/attendance/requests',
      authorized(fixture.employeeCookie, { method: 'POST', body: { businessDate: BUSINESS_DATE } }),
    );
    const request = (await submitted.json()) as { id: string };
    const approved = await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.adminCookie, { method: 'POST', body: {} }),
    );
    expect(approved.status).toBe(200);

    const closed = await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: '2026-04-01' },
      }),
    );
    expect(closed.status).toBe(200);

    const day = (await days(instance)).find((entry) => entry.businessDate === BUSINESS_DATE);
    expect(day?.closingState).toBe('closed');
    expect(day?.editable).toBe(false);
  });

  it('閲覧できない相手の月は読めない', async () => {
    const instance = app();
    const other = await createEmployeeWithAccount(testDatabase(), fixture.workspaceId, {
      organizationId: fixture.organizationId,
      employeeNumber: 'E900',
      displayName: '別の 太郎',
      email: 'other-history@example.com',
    });

    const response = await instance.request(
      `/api/attendance/days?period=2026-04-01&employeeId=${other.employeeId}`,
      authorized(fixture.employeeCookie),
    );

    expect(response.status).toBe(403);
  });
});
