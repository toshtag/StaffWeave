/**
 * 労働形態の割当が、製品の実行経路を通って計算・保存・期間の集計まで届くこと。
 *
 * `LaborSystemRepository.findForDate` はあったが、日次の計算から呼ばれていなかった。
 * 裁量労働のみなし時間は制度の側にあるため、割当を作っても計算へ届かず、
 * みなしの無い日として保存されていた。
 *
 * ここで固定したいのは 4 つ。
 *
 *   裁量の割当が、保存された日次のみなし労働分数に出ること
 *   勤務区分のみなしとの優先順位が一意に決まること
 *   有効日の境界で制度が切り替わること
 *   フレックスと変形の割当が、総枠つきで作れて期間の集計に出ること
 */
import type {
  LaborSystemAssignmentRecord,
  PeriodSummaryRecord,
  WorkCategoryRecord,
  WorkDay,
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
/** Asia/Tokyo の 2026-04-01 09:00 と 22:00。在社 780 分。 */
const IN_AT = '2026-04-01T00:00:00.000Z';
const OUT_AT = '2026-04-01T13:00:00.000Z';
const ATTENDED_MINUTES = 13 * 60;

const app = testAppFactory({ now: '2026-04-01T14:00:00.000Z' });
const nextDayApp = testAppFactory({ now: '2026-04-02T14:00:00.000Z' });

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
    displayName: '制度 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  fixture = {
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
});

async function assign(
  instance: TestApp,
  body: Record<string, unknown>,
): Promise<LaborSystemAssignmentRecord> {
  const response = await instance.request(
    '/api/labor-system-assignments',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { employeeId: fixture.employeeId, effectiveFrom: BUSINESS_DATE, ...body },
    }),
  );
  if (response.status !== 201) {
    throw new Error(
      `労働形態を割り当てられませんでした: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as LaborSystemAssignmentRecord;
}

async function createCategory(
  instance: TestApp,
  overrides: Record<string, unknown> = {},
): Promise<WorkCategoryRecord> {
  const response = await instance.request(
    '/api/work-categories',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: {
        code: 'DAY',
        internalName: '通常勤務',
        displayName: '日勤',
        categoryType: 'working_day',
        effectiveFrom: '2026-04-01',
        ...overrides,
      },
    }),
  );
  if (response.status !== 201) {
    throw new Error(`勤務区分を作れませんでした: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as WorkCategoryRecord;
}

async function scheduleDay(
  instance: TestApp,
  businessDate: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  const response = await instance.request(
    '/api/work-schedules',
    authorized(fixture.adminCookie, {
      method: 'PUT',
      body: {
        employeeId: fixture.employeeId,
        businessDate,
        dayType: 'working_day',
        startMinutes: 9 * 60,
        endMinutes: 18 * 60,
        breakMinutes: 0,
        ...body,
      },
    }),
  );
  if (response.status !== 200) {
    throw new Error(`勤務予定を置けませんでした: ${response.status} ${await response.text()}`);
  }
}

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

async function workDay(instance: TestApp, businessDate = BUSINESS_DATE): Promise<WorkDay> {
  const response = await instance.request(
    `/api/attendance/days/${businessDate}`,
    authorized(fixture.employeeCookie),
  );
  if (response.status !== 200) {
    throw new Error(`日次を読めませんでした: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as WorkDay;
}

async function workedDay(instance: TestApp, idPrefix: string): Promise<WorkDay> {
  await punch(instance, 'clock_in', IN_AT, `${idPrefix}-in`);
  await punch(instance, 'clock_out', OUT_AT, `${idPrefix}-out`);
  return workDay(instance);
}

describe('裁量労働のみなし時間', () => {
  it('割当のみなし時間が、保存された日次の計算に出る', async () => {
    const instance = app();
    await assign(instance, { systemType: 'discretionary', deemedMinutes: 7 * 60 });
    await scheduleDay(instance, BUSINESS_DATE);

    const day = await workedDay(instance, 'labor-discretionary');

    expect(day.calculation?.deemedMinutes).toBe(7 * 60);
    // みなしは実績を置き換えない。実績と並べて別の値として残す。
    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES);
  });

  /**
   * 割当を計算へ繋いでいない実装へ戻すと、上の検査は勤務区分の値を拾って
   * たまたま通ることがある。制度と勤務区分で違う値を置き、
   * どちらが出たのかを値から言えるようにする。
   */
  it('裁量の割当があるとき、勤務区分のみなしではなく制度の値が出る', async () => {
    const instance = app();
    const category = await createCategory(instance, { deemedMinutes: 4 * 60 });
    await assign(instance, { systemType: 'discretionary', deemedMinutes: 7 * 60 });
    await scheduleDay(instance, BUSINESS_DATE, { workCategoryId: category.id });

    const day = await workedDay(instance, 'labor-priority');

    expect(day.calculation?.deemedMinutes).toBe(7 * 60);
  });

  it('裁量以外の割当では、勤務区分のみなしを使う', async () => {
    const instance = app();
    const category = await createCategory(instance, { deemedMinutes: 4 * 60 });
    await assign(instance, { systemType: 'normal' });
    await scheduleDay(instance, BUSINESS_DATE, { workCategoryId: category.id });

    const day = await workedDay(instance, 'labor-normal');

    expect(day.calculation?.deemedMinutes).toBe(4 * 60);
  });

  it('割当を差し替えると、計算の版が上がる', async () => {
    const instance = app();
    await scheduleDay(instance, BUSINESS_DATE);
    const before = await workedDay(instance, 'labor-refresh');
    expect(before.calculation?.deemedMinutes).toBeNull();
    const beforeVersion = before.calculation?.version ?? 0;

    await assign(instance, { systemType: 'discretionary', deemedMinutes: 7 * 60 });
    // 予定を置き直して、その日の計算をやり直させる。
    await scheduleDay(instance, BUSINESS_DATE);

    const after = await workDay(instance);
    expect(after.calculation?.deemedMinutes).toBe(7 * 60);
    // 指紋に労働形態が入っていないと、入力は変わっていないと見なされ版が据え置かれる。
    expect(after.calculation?.version).toBeGreaterThan(beforeVersion);
  });
});

describe('有効日の境界', () => {
  it('制度が切り替わる日から、新しい制度のみなし時間になる', async () => {
    const instance = app();
    const first = await assign(instance, {
      systemType: 'discretionary',
      deemedMinutes: 7 * 60,
      effectiveTo: BUSINESS_DATE,
    });
    expect(first.effectiveTo).toBe(BUSINESS_DATE);
    await assign(instance, {
      systemType: 'discretionary',
      deemedMinutes: 6 * 60,
      effectiveFrom: '2026-04-02',
    });

    await scheduleDay(instance, BUSINESS_DATE);
    const day = await workedDay(instance, 'labor-boundary-1');
    expect(day.calculation?.deemedMinutes).toBe(7 * 60);

    const nextInstance = nextDayApp();
    // 時計を進めた側では、前日に発行した認証は既に切れている。取り直す。
    fixture.adminCookie = await loginAndGetCookie(nextInstance, { email: 'admin@example.com' });
    fixture.employeeCookie = await loginAndGetCookie(nextInstance, { email: 'hanako@example.com' });
    await scheduleDay(nextInstance, '2026-04-02');
    await punch(nextInstance, 'clock_in', '2026-04-02T00:00:00.000Z', 'labor-boundary-2-in');
    await punch(nextInstance, 'clock_out', '2026-04-02T13:00:00.000Z', 'labor-boundary-2-out');

    const nextDay = await workDay(nextInstance, '2026-04-02');
    expect(nextDay.calculation?.deemedMinutes).toBe(6 * 60);
  });
});

describe('フレックスと変形の割当', () => {
  it('総枠と決め方を添えた割当を作れ、読み直せる', async () => {
    const instance = app();
    const created = await assign(instance, {
      systemType: 'flex',
      settlementMonths: 3,
      settlementStartsOn: '2026-04-01',
      settlementBasis: 'prescribed',
      settlementTotalMinutes: 9000,
      coreStartMinutes: 11 * 60,
      coreEndMinutes: 15 * 60,
      flexibleStartMinutes: 7 * 60,
      flexibleEndMinutes: 22 * 60,
    });

    expect(created.settlementTotalMinutes).toBe(9000);
    expect(created.settlementBasis).toBe('prescribed');
    expect(created.coreStartMinutes).toBe(11 * 60);
    expect(created.flexibleEndMinutes).toBe(22 * 60);

    const response = await instance.request(
      `/api/labor-system-assignments?employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    const { laborSystemAssignments } = (await response.json()) as {
      laborSystemAssignments: LaborSystemAssignmentRecord[];
    };
    expect(laborSystemAssignments[0]?.settlementTotalMinutes).toBe(9000);
  });

  it('変形の割当でも、総枠を添えて作れる', async () => {
    const instance = app();
    const created = await assign(instance, {
      systemType: 'variable',
      settlementMonths: 1,
      settlementStartsOn: '2026-04-01',
      settlementTotalMinutes: 10440,
    });

    expect(created.systemType).toBe('variable');
    expect(created.settlementTotalMinutes).toBe(10440);
  });

  it('清算期間の集計が、割当の総枠との差を出す', async () => {
    const instance = app();
    await assign(instance, {
      systemType: 'flex',
      settlementMonths: 1,
      settlementStartsOn: '2026-04-01',
      settlementBasis: 'legal',
      settlementTotalMinutes: 10440,
    });
    await scheduleDay(instance, BUSINESS_DATE);
    await workedDay(instance, 'labor-period');

    const response = await instance.request(
      `/api/period-summaries?employeeId=${fixture.employeeId}` +
        '&from=2026-04-01&to=2026-04-30&kind=settlement',
      authorized(fixture.adminCookie),
    );
    const { summaries } = (await response.json()) as { summaries: PeriodSummaryRecord[] };

    expect(summaries[0]?.laborSystemType).toBe('flex');
    expect(summaries[0]?.totalMinutes).toBe(10440);
    expect(summaries[0]?.workedMinutes).toBe(ATTENDED_MINUTES);
    expect(summaries[0]?.differenceMinutes).toBe(ATTENDED_MINUTES - 10440);
  });
});
