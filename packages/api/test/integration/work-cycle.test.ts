import type {
  EmployeeWorkCycleRecord,
  GenerateWorkSchedulesResponse,
  LeaveTypeRecord,
  WorkCycleRecord,
  WorkDay,
  WorkPattern,
  WorkScheduleList,
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

const app = testAppFactory({ now: '2026-04-01T09:00:00.000Z' });

type App = TestApp;

interface Fixture {
  adminCookie: string;
  employeeCookie: string;
  employeeId: string;
  dayPatternId: string;
}

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const employee = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  const adminCookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

  const pattern = (await (
    await instance.request(
      '/api/work-patterns',
      authorized(adminCookie, {
        method: 'POST',
        body: { code: 'DAY', name: '日勤', startMinutes: 540, endMinutes: 1080, breakMinutes: 60 },
      }),
    )
  ).json()) as WorkPattern;

  return {
    adminCookie,
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    employeeId: employee.employeeId,
    dayPatternId: pattern.id,
  };
}

/** 週休 3 日（7 日周期のうち 4 日勤務）。 */
function fourDayWeek(patternId: string) {
  return {
    code: 'FOUR_DAY',
    name: '週 4 日勤務',
    cycleLength: 7,
    days: [
      { position: 0, dayType: 'working_day', workPatternId: patternId },
      { position: 1, dayType: 'working_day', workPatternId: patternId },
      { position: 2, dayType: 'working_day', workPatternId: patternId },
      { position: 3, dayType: 'working_day', workPatternId: patternId },
      { position: 4, dayType: 'non_working_day' },
      { position: 5, dayType: 'non_working_day' },
      { position: 6, dayType: 'non_working_day' },
    ],
  };
}

async function createCycle(
  instance: App,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return instance.request('/api/work-cycles', authorized(cookie, { method: 'POST', body }));
}

describe('休暇種別', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('登録して一覧できる', async () => {
    const instance = app();
    const response = await instance.request(
      '/api/leave-types',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { code: 'paid', name: '年次有給休暇', paid: true },
      }),
    );
    const leaveType = (await response.json()) as LeaveTypeRecord;

    expect(response.status).toBe(201);
    expect(leaveType.code).toBe('PAID');
    expect(leaveType.paid).toBe(true);
  });

  it('同じコードは登録できない', async () => {
    const instance = app();
    const body = { code: 'PAID', name: '年次有給休暇' };
    await instance.request(
      '/api/leave-types',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );
    const duplicate = await instance.request(
      '/api/leave-types',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );

    expect(duplicate.status).toBe(409);
  });
});

describe('勤務周期', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('週休 3 日を登録できる', async () => {
    const response = await createCycle(
      app(),
      fixture.adminCookie,
      fourDayWeek(fixture.dayPatternId),
    );
    const cycle = (await response.json()) as WorkCycleRecord;

    expect(response.status).toBe(201);
    expect(cycle.cycleLength).toBe(7);
    expect(cycle.days.filter((day) => day.dayType === 'working_day')).toHaveLength(4);
  });

  it('週と無関係な周期も登録できる', async () => {
    const response = await createCycle(app(), fixture.adminCookie, {
      code: 'TWO_ON_TWO_OFF',
      name: '2 勤 2 休',
      cycleLength: 4,
      days: [
        { position: 0, dayType: 'working_day', workPatternId: fixture.dayPatternId },
        { position: 1, dayType: 'working_day', workPatternId: fixture.dayPatternId },
        { position: 2, dayType: 'non_working_day' },
        { position: 3, dayType: 'non_working_day' },
      ],
    });

    expect(response.status).toBe(201);
  });

  it('位置が足りない周期は受け付けない', async () => {
    const response = await createCycle(app(), fixture.adminCookie, {
      code: 'BROKEN',
      name: '欠けた周期',
      cycleLength: 7,
      days: [{ position: 0, dayType: 'non_working_day' }],
    });

    expect(response.status).toBe(400);
  });

  it('勤務日に勤務パターンが無ければ受け付けない', async () => {
    const response = await createCycle(app(), fixture.adminCookie, {
      code: 'NO_PATTERN',
      name: 'パターン無し',
      cycleLength: 1,
      days: [{ position: 0, dayType: 'working_day' }],
    });

    expect(response.status).toBe(400);
  });

  it('従業員ロールは登録できない', async () => {
    const response = await createCycle(
      app(),
      fixture.employeeCookie,
      fourDayWeek(fixture.dayPatternId),
    );
    expect(response.status).toBe(403);
  });
});

describe('勤務周期の割当と予定の生成', () => {
  let fixture: Fixture;
  let cycleId: string;

  beforeEach(async () => {
    fixture = await setUp();
    const instance = app();
    const cycle = (await (
      await createCycle(instance, fixture.adminCookie, fourDayWeek(fixture.dayPatternId))
    ).json()) as WorkCycleRecord;
    cycleId = cycle.id;
  });

  async function assign(
    instance: App,
    body: Record<string, unknown>,
  ): Promise<EmployeeWorkCycleRecord> {
    const response = await instance.request(
      '/api/employee-work-cycles',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );
    return (await response.json()) as EmployeeWorkCycleRecord;
  }

  async function generate(
    instance: App,
    body: Record<string, unknown>,
  ): Promise<GenerateWorkSchedulesResponse> {
    const response = await instance.request(
      '/api/work-schedules/generate',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );
    return (await response.json()) as GenerateWorkSchedulesResponse;
  }

  it('割り当てた周期から予定を作れる', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
    });

    const result = await generate(instance, {
      employeeId: fixture.employeeId,
      from: '2026-04-01',
      to: '2026-04-14',
    });

    expect(result.created).toBe(14);
    expect(result.uncovered).toBe(0);

    const listed = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-01&to=2026-04-14`,
      authorized(fixture.adminCookie),
    );
    const schedules = ((await listed.json()) as WorkScheduleList).workSchedules;

    // 7 日周期で 4 日勤務なので、14 日では 8 日が勤務日になる。
    expect(schedules.filter((entry) => entry.dayType === 'working_day')).toHaveLength(8);
    expect(schedules.filter((entry) => entry.dayType === 'non_working_day')).toHaveLength(6);
    expect(schedules[0]?.startMinutes).toBe(540);
    expect(schedules[4]?.startMinutes).toBeNull();
  });

  it('割当が無い期間は決められない日として数える', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-08',
    });

    const result = await generate(instance, {
      employeeId: fixture.employeeId,
      from: '2026-04-01',
      to: '2026-04-14',
    });

    expect(result.uncovered).toBe(7);
    expect(result.created).toBe(7);
  });

  it('手で直した予定は既定では上書きしない', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
    });

    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          startMinutes: 600,
          endMinutes: 1140,
        },
      }),
    );

    const result = await generate(instance, {
      employeeId: fixture.employeeId,
      from: '2026-04-01',
      to: '2026-04-07',
    });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(6);

    const listed = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-01&to=2026-04-01`,
      authorized(fixture.adminCookie),
    );
    expect(((await listed.json()) as WorkScheduleList).workSchedules[0]?.startMinutes).toBe(600);
  });

  it('明示すれば上書きする', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
    });
    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          startMinutes: 600,
          endMinutes: 1140,
        },
      }),
    );

    await generate(instance, {
      employeeId: fixture.employeeId,
      from: '2026-04-01',
      to: '2026-04-01',
      overwrite: true,
    });

    const listed = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-01&to=2026-04-01`,
      authorized(fixture.adminCookie),
    );
    expect(((await listed.json()) as WorkScheduleList).workSchedules[0]?.startMinutes).toBe(540);
  });

  it('有効期間で制度の切り替えを表せる', async () => {
    const instance = app();
    const shortCycle = (await (
      await createCycle(instance, fixture.adminCookie, {
        code: 'EVERY_DAY',
        name: '毎日勤務',
        cycleLength: 1,
        days: [{ position: 0, dayType: 'working_day', workPatternId: fixture.dayPatternId }],
      })
    ).json()) as WorkCycleRecord;

    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
      effectiveTo: '2026-04-07',
    });
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: shortCycle.id,
      anchorDate: '2026-04-08',
      effectiveFrom: '2026-04-08',
    });

    await generate(instance, {
      employeeId: fixture.employeeId,
      from: '2026-04-01',
      to: '2026-04-14',
    });

    const listed = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-08&to=2026-04-14`,
      authorized(fixture.adminCookie),
    );
    const schedules = ((await listed.json()) as WorkScheduleList).workSchedules;

    // 切り替え後は毎日が勤務日になる。
    expect(schedules.filter((entry) => entry.dayType === 'working_day')).toHaveLength(7);
  });

  it('存在しない従業員へは割り当てられない', async () => {
    const response = await app().request(
      '/api/employee-work-cycles',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: '00000000-0000-4000-8000-000000000000',
          workCycleId: cycleId,
          anchorDate: '2026-04-01',
          effectiveFrom: '2026-04-01',
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('期間が重なる割当は受け付けない', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
    });

    // 終わりの無い割当があるため、以降のどの期間とも重なる。
    const response = await instance.request(
      '/api/employee-work-cycles',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          workCycleId: cycleId,
          anchorDate: '2026-04-01',
          effectiveFrom: '2026-04-01',
          effectiveTo: '2026-04-30',
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '終了日を設定してください',
    );

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM employee_work_cycles WHERE employee_id = $1',
      [fixture.employeeId],
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('前の割当へ終了日を設定してから次を割り当てられる', async () => {
    const instance = app();
    const first = await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
    });

    const ended = await instance.request(
      `/api/employee-work-cycles/${first.id}/end`,
      authorized(fixture.adminCookie, { method: 'POST', body: { effectiveTo: '2026-04-07' } }),
    );
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as EmployeeWorkCycleRecord).effectiveTo).toBe('2026-04-07');

    const next = await instance.request(
      '/api/employee-work-cycles',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          workCycleId: cycleId,
          anchorDate: '2026-04-08',
          effectiveFrom: '2026-04-08',
        },
      }),
    );
    expect(next.status).toBe(201);
  });

  it('終了日を伸ばして次の割当と重ねられない', async () => {
    const instance = app();
    const first = await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
      effectiveTo: '2026-04-07',
    });
    await assign(instance, {
      employeeId: fixture.employeeId,
      workCycleId: cycleId,
      anchorDate: '2026-04-08',
      effectiveFrom: '2026-04-08',
    });

    const response = await instance.request(
      `/api/employee-work-cycles/${first.id}/end`,
      authorized(fixture.adminCookie, { method: 'POST', body: { effectiveTo: '2026-04-30' } }),
    );

    expect(response.status).toBe(409);
  });

  it('存在しない割当には終了日を設定できない', async () => {
    const response = await app().request(
      '/api/employee-work-cycles/00000000-0000-4000-8000-000000000000/end',
      authorized(fixture.adminCookie, { method: 'POST', body: { effectiveTo: '2026-04-30' } }),
    );

    expect(response.status).toBe(404);
  });

  it('終了日が開始日より前なら受け付けない', async () => {
    const response = await app().request(
      '/api/employee-work-cycles',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          workCycleId: cycleId,
          anchorDate: '2026-04-01',
          effectiveFrom: '2026-04-10',
          effectiveTo: '2026-04-01',
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  // 一覧は従業員を必須にし、値の形も契約どおりに確かめる。
  it.each([
    ['/api/employee-work-cycles', '従業員を指定しない'],
    ['/api/employee-work-cycles?employeeId=not-a-uuid', '識別子の形が違う'],
  ])('%s の一覧は 400 を返す（%s）', async (path) => {
    const response = await app().request(path, authorized(fixture.adminCookie));
    expect(response.status).toBe(400);
  });
});

describe('休暇と欠勤', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('休暇の日は休暇時間として集計される', async () => {
    const instance = app();
    const leaveType = (await (
      await instance.request(
        '/api/leave-types',
        authorized(fixture.adminCookie, {
          method: 'POST',
          body: { code: 'PAID', name: '年次有給休暇' },
        }),
      )
    ).json()) as LeaveTypeRecord;

    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          dayType: 'leave',
          startMinutes: 540,
          endMinutes: 1080,
          breakMinutes: 60,
          leaveTypeId: leaveType.id,
        },
      }),
    );

    const response = await instance.request(
      '/api/attendance/days/2026-04-01',
      authorized(fixture.employeeCookie),
    );
    const day = (await response.json()) as WorkDay;

    expect(day.schedule?.dayType).toBe('leave');
    expect(day.schedule?.leaveTypeId).toBe(leaveType.id);
    expect(day.calculation?.leaveMinutes).toBe(8 * 60);
    expect(day.calculation?.absenceMinutes).toBe(0);
    expect(day.calculation?.workedMinutes).toBe(0);
  });

  it('欠勤の日は欠勤時間として集計される', async () => {
    const instance = app();
    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-02',
          dayType: 'absence',
          startMinutes: 540,
          endMinutes: 1080,
          breakMinutes: 60,
        },
      }),
    );

    const response = await instance.request(
      '/api/attendance/days/2026-04-02',
      authorized(fixture.employeeCookie),
    );
    const day = (await response.json()) as WorkDay;

    expect(day.calculation?.absenceMinutes).toBe(8 * 60);
    expect(day.calculation?.leaveMinutes).toBe(0);
    expect(day.calculation?.nonWorkingDayMinutes).toBe(0);
  });

  it('休暇以外の日には休暇種別を持たせない', async () => {
    const instance = app();
    const leaveType = (await (
      await instance.request(
        '/api/leave-types',
        authorized(fixture.adminCookie, {
          method: 'POST',
          body: { code: 'PAID', name: '年次有給休暇' },
        }),
      )
    ).json()) as LeaveTypeRecord;

    const response = await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-03',
          dayType: 'working_day',
          startMinutes: 540,
          endMinutes: 1080,
          leaveTypeId: leaveType.id,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as { leaveTypeId: string | null }).leaveTypeId).toBeNull();
  });
});
