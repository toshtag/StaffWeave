/**
 * 勤務区分の設定が、製品の実行経路を通って計算・保存・月次・給与まで届くこと。
 *
 * 勤務区分は domain の計算関数が受け取れる形になっているが、それだけでは
 * 「設定できる」と「効いている」は別のままになる。管理画面と API から作った
 * 勤務区分を勤務予定へ割り当て、打刻して、保存された計算・月次の集計・
 * 給与の CSV に同じ値が出るところまでを 1 本で通す。
 *
 * ここで固定したいのは 5 つ。
 *
 *   勤務予定が勤務区分を持ち、読み書きできること
 *   固定休憩と深夜帯の上書きが、保存された日次の計算へ効くこと
 *   同じ値が月次の集計と給与の CSV まで届くこと
 *   対象日に効いている版が選ばれ、版が変われば結果も変わること
 *   勤務区分を外すと結果が変わること（外したまま通らないこと）
 */
import type { WorkCategoryRecord, WorkDay, WorkScheduleRecord } from '@staffweave/contracts';
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
const PERIOD = '2026-04-01';
/** Asia/Tokyo の 2026-04-01 09:00 と 22:00。 */
const IN_AT = '2026-04-01T00:00:00.000Z';
const OUT_AT = '2026-04-01T13:00:00.000Z';

/** 09:00–22:00 で在社 780 分。固定休憩 60 分を引くと実労働 720 分。 */
const ATTENDED_MINUTES = 13 * 60;
const FIXED_BREAK_MINUTES = 60;

const app = testAppFactory({ now: '2026-04-01T14:00:00.000Z' });
// 翌日の打刻を見る検査だけは、その日を過ぎた時点で動かす。
// 打刻は未来へ置けないため、同じ「いま」のままでは 2 日目を作れない。
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
    displayName: '区分 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  fixture = {
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
});

/**
 * 昼休みを固定休憩として持ち、深夜帯を 21:00 からへ上書きする勤務区分。
 *
 * 既定の深夜帯（22:00 開始）とずらすのは、上書きが効いていない場合と
 * 効いている場合で深夜の分数が変わるようにするため。同じ値にすると、
 * 計算へ届いていなくてもテストが通ってしまう。
 */
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
        scheduledStartMinutes: 9 * 60,
        scheduledEndMinutes: 18 * 60,
        fixedBreaks: [{ startMinutes: 12 * 60, endMinutes: 13 * 60 }],
        nightStartMinutes: 21 * 60,
        nightEndMinutes: 4 * 60,
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
  body: Record<string, unknown> = {},
): Promise<WorkScheduleRecord> {
  const response = await instance.request(
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
        ...body,
      },
    }),
  );
  if (response.status !== 200) {
    throw new Error(`勤務予定を置けませんでした: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as WorkScheduleRecord;
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

/** 打刻まで済ませた 1 日を作る。 */
async function workedDayWith(
  instance: TestApp,
  schedule: Record<string, unknown>,
  idPrefix: string,
): Promise<WorkDay> {
  await scheduleDay(instance, schedule);
  await punch(instance, 'clock_in', IN_AT, `${idPrefix}-in`);
  await punch(instance, 'clock_out', OUT_AT, `${idPrefix}-out`);
  return workDay(instance);
}

describe('勤務区分を勤務予定へ紐付ける', () => {
  it('割り当てた勤務区分が読み書きできる', async () => {
    const instance = app();
    const category = await createCategory(instance);

    const saved = await scheduleDay(instance, { workCategoryId: category.id });
    expect(saved.workCategoryId).toBe(category.id);

    const response = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`,
      authorized(fixture.adminCookie),
    );
    const { workSchedules } = (await response.json()) as { workSchedules: WorkScheduleRecord[] };
    expect(workSchedules[0]?.workCategoryId).toBe(category.id);
  });

  it('所定時刻を省略すると、勤務区分の所定時刻で埋まる', async () => {
    const instance = app();
    const category = await createCategory(instance);

    const saved = await scheduleDay(instance, {
      workCategoryId: category.id,
      startMinutes: undefined,
      endMinutes: undefined,
    });

    expect(saved.startMinutes).toBe(9 * 60);
    expect(saved.endMinutes).toBe(18 * 60);
  });

  it('対象日に効いていない版は割り当てられない', async () => {
    const instance = app();
    const category = await createCategory(instance, { effectiveFrom: '2026-05-01' });

    const response = await instance.request(
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
          workCategoryId: category.id,
        },
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('勤務区分の設定が日次の計算へ効く', () => {
  it('固定休憩と深夜帯の上書きが、保存された計算に出る', async () => {
    const instance = app();
    const category = await createCategory(instance);

    const day = await workedDayWith(instance, { workCategoryId: category.id }, 'category-present');

    expect(day.calculation?.attendedMinutes).toBe(ATTENDED_MINUTES);
    // 固定休憩の 60 分は、休憩の打刻が無くても引かれる。
    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES - FIXED_BREAK_MINUTES);
    // 深夜帯は 21:00 からになる。退勤の 22:00 までの 60 分が深夜。
    expect(day.calculation?.nightMinutes).toBe(60);
  });

  /**
   * 勤務区分を外した経路が別の結果になること。
   *
   * 計算へ勤務区分を渡していない実装へ戻すと、上の検査とこの検査は
   * 同じ値になり、両方とも通ってしまう。差が出ることをここで固定する。
   */
  it('勤務区分を外すと、固定休憩も深夜帯の上書きも効かない', async () => {
    const instance = app();
    await createCategory(instance);

    const day = await workedDayWith(instance, {}, 'category-absent');

    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES);
    // 既定の深夜帯は 22:00 から。22:00 退勤なので深夜は 0 分。
    expect(day.calculation?.nightMinutes).toBe(0);
  });

  it('自動休憩が、保存された計算に出る', async () => {
    const instance = app();
    // 固定休憩は置かず、実労働 6 時間超で 45 分を足す規則だけを持たせる。
    const category = await createCategory(instance, {
      code: 'AUTO',
      fixedBreaks: [],
      autoBreaks: [{ thresholdMinutes: 6 * 60, additionalMinutes: 45 }],
    });

    const day = await workedDayWith(instance, { workCategoryId: category.id }, 'category-auto');

    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES - 45);
  });

  it('みなし労働時間が、保存された計算に出る', async () => {
    const instance = app();
    const category = await createCategory(instance, {
      code: 'DEEMED',
      fixedBreaks: [],
      deemedMinutes: 8 * 60,
    });

    const day = await workedDayWith(instance, { workCategoryId: category.id }, 'category-deemed');

    // みなしは実績を置き換えない。実績と並べて別の値として残す。
    expect(day.calculation?.deemedMinutes).toBe(8 * 60);
    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES);
  });

  it('中抜けを休憩として扱う設定が、保存された計算に出る', async () => {
    const instance = app();
    const category = await createCategory(instance, {
      code: 'GAP',
      fixedBreaks: [],
      gapTreatment: 'break',
    });

    await scheduleDay(instance, { workCategoryId: category.id });
    // 09:00–12:00 と 14:00–18:00。間の 2 時間が中抜けになる。
    await punch(instance, 'clock_in', '2026-04-01T00:00:00.000Z', 'category-gap-in-1');
    await punch(instance, 'clock_out', '2026-04-01T03:00:00.000Z', 'category-gap-out-1');
    await punch(instance, 'clock_in', '2026-04-01T05:00:00.000Z', 'category-gap-in-2');
    await punch(instance, 'clock_out', '2026-04-01T09:00:00.000Z', 'category-gap-out-2');

    const day = await workDay(instance);
    // 実労働は 3 時間 + 4 時間。中抜けの 2 時間は休憩として数える。
    expect(day.calculation?.workedMinutes).toBe(7 * 60);
    expect(day.calculation?.breakMinutes).toBe(2 * 60);
  });
});

describe('勤務区分の版', () => {
  it('対象日に効いている版で計算する', async () => {
    const instance = app();
    const first = await createCategory(instance, { effectiveTo: '2026-04-01' });
    // 同じコードの次の版。固定休憩を 2 時間へ広げる。
    await createCategory(instance, {
      effectiveFrom: '2026-04-02',
      fixedBreaks: [{ startMinutes: 12 * 60, endMinutes: 14 * 60 }],
    });

    const day = await workedDayWith(instance, { workCategoryId: first.id }, 'category-version');
    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES - FIXED_BREAK_MINUTES);

    // 翌日は次の版が効く。割当が指すのは前の版の id だが、コードを辿って選び直す。
    const nextInstance = nextDayApp();
    // 時計を進めた側では、前日に発行した認証は既に切れている。取り直す。
    fixture.adminCookie = await loginAndGetCookie(nextInstance, { email: 'admin@example.com' });
    fixture.employeeCookie = await loginAndGetCookie(nextInstance, { email: 'hanako@example.com' });
    await nextInstance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-02',
          dayType: 'working_day',
          startMinutes: 9 * 60,
          endMinutes: 18 * 60,
          breakMinutes: 0,
          workCategoryId: first.id,
        },
      }),
    );
    await punch(nextInstance, 'clock_in', '2026-04-02T00:00:00.000Z', 'category-version-in-2');
    await punch(nextInstance, 'clock_out', '2026-04-02T13:00:00.000Z', 'category-version-out-2');

    const nextDay = await workDay(nextInstance, '2026-04-02');
    expect(nextDay.calculation?.workedMinutes).toBe(ATTENDED_MINUTES - 2 * 60);
  });

  it('勤務区分を差し替えると、計算の版が上がる', async () => {
    const instance = app();
    const category = await createCategory(instance);

    const before = await workedDayWith(instance, {}, 'category-refresh');
    expect(before.calculation?.workedMinutes).toBe(ATTENDED_MINUTES);
    const beforeVersion = before.calculation?.version ?? 0;

    await scheduleDay(instance, { workCategoryId: category.id });

    const after = await workDay(instance);
    expect(after.calculation?.workedMinutes).toBe(ATTENDED_MINUTES - FIXED_BREAK_MINUTES);
    // 指紋に勤務区分が入っていないと、入力は変わっていないと見なされ版が据え置かれる。
    expect(after.calculation?.version).toBeGreaterThan(beforeVersion);
  });
});

describe('月次と給与への引き渡し', () => {
  it('勤務区分を反映した実労働が、月次の集計に出る', async () => {
    const instance = app();
    const category = await createCategory(instance);
    await workedDayWith(instance, { workCategoryId: category.id }, 'category-month');

    const response = await instance.request(
      `/api/monthly-summaries?period=${PERIOD}&employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    const { summaries } = (await response.json()) as {
      summaries: { workedMinutes: number; nightMinutes: number }[];
    };

    expect(summaries[0]?.workedMinutes).toBe(ATTENDED_MINUTES - FIXED_BREAK_MINUTES);
    expect(summaries[0]?.nightMinutes).toBe(60);
  });

  it('勤務区分を反映した実労働が、給与の CSV に出る', async () => {
    const instance = app();
    const category = await createCategory(instance);
    await workedDayWith(instance, { workCategoryId: category.id }, 'category-csv');

    const response = await instance.request(
      `/api/exports/payroll.csv?period=${PERIOD}`,
      authorized(fixture.adminCookie),
    );
    const csv = await response.text();
    const [header, row] = csv.trim().split('\n');
    const columns = (line: string): string[] =>
      line.split(',').map((value) => value.replaceAll('"', ''));

    const names = columns(header ?? '');
    const values = columns(row ?? '');
    const columnValue = (name: string): string => values[names.indexOf(name)] ?? '';

    expect(columnValue('worked_minutes')).toBe(String(ATTENDED_MINUTES - FIXED_BREAK_MINUTES));
    expect(columnValue('night_minutes')).toBe('60');
  });
});

describe('勤務区分の設定が、予定と集計へ効く', () => {
  it('日種別を勤務区分から写す', async () => {
    const instance = app();
    const category = await createCategory(instance, {
      code: 'LEGAL',
      categoryType: 'legal_holiday',
      scheduledStartMinutes: undefined,
      scheduledEndMinutes: undefined,
      fixedBreaks: [],
    });

    // 日種別を明示しなければ、勤務区分の種別が予定の日種別になる。
    const saved = await scheduleDay(instance, {
      workCategoryId: category.id,
      dayType: undefined,
      startMinutes: undefined,
      endMinutes: undefined,
    });

    expect(saved.dayType).toBe('legal_holiday');
  });

  it('明示した日種別は、勤務区分より優先する', async () => {
    const instance = app();
    const category = await createCategory(instance, {
      code: 'LEGAL2',
      categoryType: 'legal_holiday',
    });

    const saved = await scheduleDay(instance, {
      workCategoryId: category.id,
      dayType: 'working_day',
    });

    expect(saved.dayType).toBe('working_day');
  });

  it('法定休日の勤務区分を割り当てると、法定休日労働として数える', async () => {
    const instance = app();
    const category = await createCategory(instance, {
      code: 'LEGAL3',
      categoryType: 'legal_holiday',
      fixedBreaks: [],
    });

    await scheduleDay(instance, {
      workCategoryId: category.id,
      dayType: undefined,
      startMinutes: undefined,
      endMinutes: undefined,
    });
    await punch(instance, 'clock_in', IN_AT, 'category-legal-in');
    await punch(instance, 'clock_out', OUT_AT, 'category-legal-out');
    const day = await workDay(instance);

    expect(day.calculation?.legalHolidayMinutes).toBe(ATTENDED_MINUTES);
    expect(day.calculation?.nonLegalHolidayMinutes).toBe(0);
  });

  it('所定労働分数を決めてあれば、所定はその値になる', async () => {
    const instance = app();
    // 09:00–18:00 の所定でも、決めた 7 時間を採る。
    const category = await createCategory(instance, {
      code: 'PRESCRIBED',
      prescribedMinutes: 7 * 60,
      fixedBreaks: [],
    });

    const day = await workedDayWith(
      instance,
      { workCategoryId: category.id },
      'category-prescribed',
    );

    expect(day.calculation?.scheduledMinutes).toBe(7 * 60);
  });

  it('出勤日として数えない勤務区分の日は、月次の出勤日数へ入らない', async () => {
    const instance = app();
    const category = await createCategory(instance, {
      code: 'NOTCOUNTED',
      countsAsWorkingDay: false,
      fixedBreaks: [],
    });

    const day = await workedDayWith(instance, { workCategoryId: category.id }, 'category-notcount');
    expect(day.calculation?.workedMinutes).toBe(ATTENDED_MINUTES);
    expect(day.calculation?.countsAsWorkingDay).toBe(false);

    const response = await instance.request(
      `/api/monthly-summaries?period=${PERIOD}&employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    const { summaries } = (await response.json()) as { summaries: { workedDays: number }[] };

    // 実労働はあるが、出勤日としては数えない。
    expect(summaries[0]?.workedDays).toBe(0);
  });
});
