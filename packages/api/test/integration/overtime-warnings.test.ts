/**
 * 長時間労働の警告。
 *
 * ここで固定したいのは 3 つ。
 *
 *   上限が未設定なら、0 件ではなく「見ていない」と返すこと
 *   1 日でも閾値が未設定の月を、時間外 0 分の月に化けさせないこと
 *   閲覧できる範囲の外の従業員が混ざらないこと
 */
import type { OvertimeWarningList } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
  type TestApp,
  testAppFactory,
} from '../support/fixtures.js';

const PERIOD = '2026-04-01';
const app = testAppFactory({ now: '2026-04-30T14:00:00.000Z' });

interface Fixture {
  workspaceId: string;
  employeeId: string;
  outsiderId: string;
  adminCookie: string;
  managerCookie: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const headquarters = await createOrganization(db, workspaceId, { code: 'HQ' });
  const branch = await createOrganization(db, workspaceId, { code: 'BR' });

  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const manager = await createUser(db, workspaceId, {
    email: 'manager@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: manager, organizationId: headquarters });

  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: headquarters,
    employeeNumber: 'E001',
    displayName: '長時間 花子',
    email: 'hanako@example.com',
  });
  const outsider = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: branch,
    employeeNumber: 'E002',
    displayName: '支社 次郎',
    email: 'jiro@example.com',
  });

  const instance = app();
  fixture = {
    workspaceId,
    employeeId: employee.employeeId,
    outsiderId: outsider.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    managerCookie: await loginAndGetCookie(instance, { email: 'manager@example.com' }),
  };
});

async function ruleVersion(instance: TestApp, body: Record<string, unknown>): Promise<Response> {
  return instance.request(
    '/api/calculation-rule-versions',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: {
        effectiveFrom: '2026-01-01',
        dayStartMinutes: 0,
        nightStartMinutes: 22 * 60,
        nightEndMinutes: 5 * 60,
        roundingMinutes: 0,
        roundingMode: 'none',
        weekStartsOn: 1,
        monthStartsOn: 1,
        ...body,
      },
    }),
  );
}

/** 法定時間外を持つ日次の計算を、直接積む。 */
async function calculation(
  employeeId: string,
  businessDate: string,
  legalOvertimeMinutes: number | null,
): Promise<void> {
  const db = testDatabase();
  await db.query(
    `INSERT INTO attendance_calculations
       (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
        attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
        within_schedule_minutes, outside_schedule_minutes, night_minutes,
        non_working_day_minutes, leave_minutes, absence_minutes,
        legal_overtime_minutes, basis)
     VALUES ($1, $2, $3, 1, $4, 'v1', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, $5, '{}'::jsonb)`,
    [
      fixture.workspaceId,
      employeeId,
      businessDate,
      `warning-${employeeId}-${businessDate}`,
      legalOvertimeMinutes,
    ],
  );
}

async function warnings(
  instance: TestApp,
  cookie = fixture.adminCookie,
): Promise<OvertimeWarningList> {
  const response = await instance.request(
    `/api/overtime-warnings?period=${PERIOD}`,
    authorized(cookie),
  );
  if (response.status !== 200) throw new Error(`警告を読めませんでした: ${response.status}`);
  return (await response.json()) as OvertimeWarningList;
}

describe('長時間労働の警告', () => {
  it('上限が未設定なら、0 件ではなく見ていないことを返す', async () => {
    const instance = app();
    await ruleVersion(instance, {});
    await calculation(fixture.employeeId, '2026-04-01', 60 * 60);

    const result = await warnings(instance);

    expect(result).toEqual({
      warnings: [],
      monthlyLimitMinutes: null,
      averageLimitMinutes: null,
      averageMonths: null,
    });
  });

  it('1 か月の上限を超えた従業員を出す', async () => {
    const instance = app();
    await ruleVersion(instance, { monthlyOvertimeLimitMinutes: 45 * 60 });
    await calculation(fixture.employeeId, '2026-04-01', 30 * 60);
    await calculation(fixture.employeeId, '2026-04-02', 20 * 60);

    const result = await warnings(instance);

    expect(result.monthlyLimitMinutes).toBe(45 * 60);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      employeeNumber: 'E001',
      legalOvertimeMinutes: 50 * 60,
      exceededMonthlyBy: 5 * 60,
    });
  });

  it('上限を超えていない従業員は出さない', async () => {
    const instance = app();
    await ruleVersion(instance, { monthlyOvertimeLimitMinutes: 45 * 60 });
    await calculation(fixture.employeeId, '2026-04-01', 10 * 60);

    expect((await warnings(instance)).warnings).toEqual([]);
  });

  it('1 日でも閾値が未設定なら、その月は判断できないものとして扱う', async () => {
    const instance = app();
    await ruleVersion(instance, { monthlyOvertimeLimitMinutes: 45 * 60 });
    await calculation(fixture.employeeId, '2026-04-01', 60 * 60);
    await calculation(fixture.employeeId, '2026-04-02', null);

    const result = await warnings(instance);

    // 判断できないので、警告としては出さない。0 分として足さない。
    expect(result.warnings).toEqual([]);
  });

  it('複数月の平均の上限を超えた従業員を出す', async () => {
    const instance = app();
    await ruleVersion(instance, {
      averageOvertimeLimitMinutes: 40 * 60,
      averageOvertimeMonths: 3,
    });
    for (const [period, minutes] of [
      ['2026-02-01', 60 * 60],
      ['2026-03-01', 60 * 60],
      ['2026-04-01', 60 * 60],
    ] as const) {
      await calculation(fixture.employeeId, period, minutes);
    }

    const result = await warnings(instance);

    expect(result.averageMonths).toBe(3);
    expect(result.warnings[0]).toMatchObject({
      averageMinutes: 60 * 60,
      exceededAverageBy: 20 * 60,
    });
  });

  it('平均を取る月に判断できない月があれば、平均を出さない', async () => {
    const instance = app();
    await ruleVersion(instance, {
      averageOvertimeLimitMinutes: 40 * 60,
      averageOvertimeMonths: 3,
    });
    await calculation(fixture.employeeId, '2026-04-01', 60 * 60);
    await calculation(fixture.employeeId, '2026-03-01', null);

    const result = await warnings(instance);

    expect(result.warnings).toEqual([]);
  });

  it('閲覧できる範囲の外の従業員は混ざらない', async () => {
    const instance = app();
    await ruleVersion(instance, { monthlyOvertimeLimitMinutes: 45 * 60 });
    await calculation(fixture.employeeId, '2026-04-01', 60 * 60);
    await calculation(fixture.outsiderId, '2026-04-01', 60 * 60);

    const result = await warnings(instance, fixture.managerCookie);

    expect(result.warnings.map((entry) => entry.employeeNumber)).toEqual(['E001']);
  });

  it('従業員は警告を読めない', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'hanako@example.com' });

    const response = await instance.request(
      `/api/overtime-warnings?period=${PERIOD}`,
      authorized(cookie),
    );

    expect(response.status).toBe(403);
  });
});
