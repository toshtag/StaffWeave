/**
 * 計算規則と勤務予定の設定が、製品の実行経路を通って保存された計算へ届くこと。
 *
 * 丸めと遅刻・早退は、これまで domain の単体テストだけで固定していた。
 * 計算関数が正しくても、設定した値がそこへ渡っていなければ何も効かない。
 * 「設定できる」と「効いている」は別なので、API から規則を作り、予定を置き、
 * 打刻して、保存された日次の計算に同じ値が出るところまでを 1 本で通す。
 *
 * ここで固定したいのは 3 つ。
 *
 *   作った計算規則の版が、その日の計算に選ばれること
 *   丸めの単位と丸め方が、保存された分数に効いていること
 *   予定に対する遅刻・早退が、保存された分数に出ること
 */
import type { CalculationRuleVersionRecord, WorkDay } from '@staffweave/contracts';
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

/** Asia/Tokyo の 2026-04-01 09:07 と 17:52。予定は 09:00–18:00。 */
const IN_AT = '2026-04-01T00:07:00.000Z';
const OUT_AT = '2026-04-01T08:52:00.000Z';

/** 09:07–17:52 で在社 525 分。丸めが効かなければこの値のまま。 */
const RAW_MINUTES = 525;

const app = testAppFactory({ now: '2026-04-01T14:00:00.000Z' });

interface Fixture {
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
    displayName: '規則 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  fixture = {
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
});

async function createRuleVersion(
  instance: TestApp,
  overrides: Record<string, unknown>,
): Promise<CalculationRuleVersionRecord> {
  const response = await instance.request(
    '/api/calculation-rule-versions',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: {
        effectiveFrom: '2026-04-01',
        dayStartMinutes: 0,
        nightStartMinutes: 22 * 60,
        nightEndMinutes: 5 * 60,
        roundingMinutes: 0,
        roundingMode: 'none',
        weekStartsOn: 1,
        monthStartsOn: 1,
        ...overrides,
      },
    }),
  );
  if (response.status !== 201) {
    throw new Error(`計算規則を作れませんでした: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as CalculationRuleVersionRecord;
}

async function workedDay(instance: TestApp, idPrefix: string): Promise<WorkDay> {
  const schedule = await instance.request(
    '/api/work-schedules',
    authorized(fixture.adminCookie, {
      method: 'PUT',
      body: {
        employeeId: fixture.employeeId,
        businessDate: BUSINESS_DATE,
        dayType: 'working_day',
        startMinutes: 9 * 60,
        endMinutes: 18 * 60,
        breakMinutes: 0,
      },
    }),
  );
  if (schedule.status !== 200) {
    throw new Error(`勤務予定を置けませんでした: ${schedule.status} ${await schedule.text()}`);
  }

  for (const [eventType, occurredAt, suffix] of [
    ['clock_in', IN_AT, 'in'],
    ['clock_out', OUT_AT, 'out'],
  ] as const) {
    const response = await instance.request(
      '/api/attendance/events',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { eventType, occurredAt, requestId: `${idPrefix}-${suffix}` },
      }),
    );
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(`打刻できませんでした: ${response.status} ${await response.text()}`);
    }
  }

  const day = await instance.request(
    `/api/attendance/days/${BUSINESS_DATE}`,
    authorized(fixture.employeeCookie),
  );
  if (day.status !== 200) {
    throw new Error(`日次を読めませんでした: ${day.status} ${await day.text()}`);
  }
  return (await day.json()) as WorkDay;
}

describe('丸めの設定が、保存された計算へ効く', () => {
  it('丸めなしのときは、打刻どおりの分数を保存する', async () => {
    const instance = app();
    await createRuleVersion(instance, {});

    const day = await workedDay(instance, 'rounding-none');

    expect(day.calculation?.attendedMinutes).toBe(RAW_MINUTES);
    expect(day.calculation?.workedMinutes).toBe(RAW_MINUTES);
  });

  it('15 分単位の切り捨てが、保存された分数に出る', async () => {
    const instance = app();
    await createRuleVersion(instance, { roundingMinutes: 15, roundingMode: 'down' });

    const day = await workedDay(instance, 'rounding-down');

    // 525 分は 15 で割り切れるため、この単位では値が動かない。
    // 効いていることは、端数の出る 10 分単位で確かめる。
    expect(day.calculation?.workedMinutes).toBe(Math.floor(RAW_MINUTES / 15) * 15);
  });

  it('10 分単位の切り捨てで、端数が落ちる', async () => {
    const instance = app();
    await createRuleVersion(instance, { roundingMinutes: 10, roundingMode: 'down' });

    const day = await workedDay(instance, 'rounding-down10');

    expect(RAW_MINUTES % 10).not.toBe(0);
    expect(day.calculation?.workedMinutes).toBe(520);
  });

  it('10 分単位の四捨五入では、切り捨てと違う値になる', async () => {
    const instance = app();
    await createRuleVersion(instance, { roundingMinutes: 10, roundingMode: 'nearest' });

    const day = await workedDay(instance, 'rounding-nearest');

    expect(day.calculation?.workedMinutes).toBe(530);
  });
});

describe('遅刻と早退が、保存された計算へ出る', () => {
  it('予定より遅く来て早く帰った分が、そのまま分数として残る', async () => {
    const instance = app();
    await createRuleVersion(instance, {});

    const day = await workedDay(instance, 'late-plain');

    // 予定 09:00–18:00 に対して 09:07–17:52。
    expect(day.calculation?.lateMinutes).toBe(7);
    expect(day.calculation?.earlyLeaveMinutes).toBe(8);
  });

  it('丸めは遅刻と早退にも同じように効く', async () => {
    const instance = app();
    await createRuleVersion(instance, { roundingMinutes: 15, roundingMode: 'down' });

    const day = await workedDay(instance, 'late-rounded-x');

    // 丸めは分数の項目すべてへ一律に効く。項目ごとに効かせ方を変えると、
    // 「どれが丸められた値か」を読む側が覚えていないと足し算が合わなくなる。
    // 結果として、15 分未満の遅刻・早退は 0 分として残る。切り捨ての向きは
    // 働いた側に不利へ働かないため、そのままにしている。
    expect(day.calculation?.lateMinutes).toBe(0);
    expect(day.calculation?.earlyLeaveMinutes).toBe(0);
  });
});
