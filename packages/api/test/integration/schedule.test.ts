import type {
  RecordAttendanceEventResponse,
  WorkDay,
  WorkPattern,
  WorkPatternList,
  WorkScheduleList,
  WorkScheduleRecord,
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
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

interface Fixture {
  workspaceId: string;
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
}

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const { employeeId } = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = createTestApp();
  return {
    workspaceId,
    employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
}

async function punch(
  instance: TestApp,
  cookie: string,
  body: Record<string, unknown>,
): Promise<RecordAttendanceEventResponse> {
  const response = await instance.request(
    '/api/attendance/events',
    authorized(cookie, { method: 'POST', body }),
  );
  return (await response.json()) as RecordAttendanceEventResponse;
}

describe('勤務パターン', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('登録して一覧できる', async () => {
    const instance = createTestApp();
    const response = await instance.request(
      '/api/work-patterns',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { code: 'day', name: '日勤', startMinutes: 540, endMinutes: 1080, breakMinutes: 60 },
      }),
    );
    const pattern = (await response.json()) as WorkPattern;

    expect(response.status).toBe(201);
    expect(pattern.code).toBe('DAY');

    const listed = await instance.request('/api/work-patterns', authorized(fixture.adminCookie));
    expect(((await listed.json()) as WorkPatternList).workPatterns).toHaveLength(1);
  });

  it('日をまたぐ勤務パターンを登録できる', async () => {
    const response = await createTestApp().request(
      '/api/work-patterns',
      authorized(fixture.adminCookie, {
        method: 'POST',
        // 22:00 から翌 7:00。
        body: {
          code: 'NIGHT',
          name: '夜勤',
          startMinutes: 1320,
          endMinutes: 1860,
          breakMinutes: 60,
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as WorkPattern).endMinutes).toBe(1860);
  });

  it('終業が始業以前なら受け付けない', async () => {
    const response = await createTestApp().request(
      '/api/work-patterns',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { code: 'BAD', name: '不正', startMinutes: 1080, endMinutes: 540 },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('同じコードは登録できない', async () => {
    const instance = createTestApp();
    const body = { code: 'DAY', name: '日勤', startMinutes: 540, endMinutes: 1080 };
    await instance.request(
      '/api/work-patterns',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );
    const duplicate = await instance.request(
      '/api/work-patterns',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );

    expect(duplicate.status).toBe(409);
  });

  it('従業員ロールは登録できない', async () => {
    const response = await createTestApp().request(
      '/api/work-patterns',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { code: 'DAY', name: '日勤', startMinutes: 540, endMinutes: 1080 },
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe('勤務予定', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('勤務パターンから予定を作れる', async () => {
    const instance = createTestApp();
    const created = await instance.request(
      '/api/work-patterns',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { code: 'DAY', name: '日勤', startMinutes: 540, endMinutes: 1080, breakMinutes: 60 },
      }),
    );
    const pattern = (await created.json()) as WorkPattern;

    const response = await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          workPatternId: pattern.id,
        },
      }),
    );
    const schedule = (await response.json()) as WorkScheduleRecord;

    expect(response.status).toBe(200);
    expect(schedule.startMinutes).toBe(540);
    expect(schedule.endMinutes).toBe(1080);
    expect(schedule.breakMinutes).toBe(60);
    expect(schedule.dayType).toBe('working_day');
  });

  it('同じ日に登録し直すと上書きされる', async () => {
    const instance = createTestApp();
    const body = {
      employeeId: fixture.employeeId,
      businessDate: '2026-04-01',
      startMinutes: 540,
      endMinutes: 1080,
      breakMinutes: 60,
    };
    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, { method: 'PUT', body }),
    );
    const updated = await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: { ...body, startMinutes: 600, endMinutes: 1140 },
      }),
    );

    expect(((await updated.json()) as WorkScheduleRecord).startMinutes).toBe(600);

    const listed = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-01&to=2026-04-01`,
      authorized(fixture.adminCookie),
    );
    expect(((await listed.json()) as WorkScheduleList).workSchedules).toHaveLength(1);
  });

  it('休日を指定すると予定時刻は持たない', async () => {
    const response = await createTestApp().request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-04',
          dayType: 'non_working_day',
          startMinutes: 540,
          endMinutes: 1080,
        },
      }),
    );
    const schedule = (await response.json()) as WorkScheduleRecord;

    expect(schedule.dayType).toBe('non_working_day');
    expect(schedule.startMinutes).toBeNull();
    expect(schedule.endMinutes).toBeNull();
  });

  it('期間を指定して一覧できる', async () => {
    const instance = createTestApp();
    for (const businessDate of ['2026-04-01', '2026-04-02', '2026-04-10']) {
      await instance.request(
        '/api/work-schedules',
        authorized(fixture.adminCookie, {
          method: 'PUT',
          body: {
            employeeId: fixture.employeeId,
            businessDate,
            startMinutes: 540,
            endMinutes: 1080,
          },
        }),
      );
    }

    const response = await instance.request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-01&to=2026-04-05`,
      authorized(fixture.adminCookie),
    );

    expect(((await response.json()) as WorkScheduleList).workSchedules).toHaveLength(2);
  });

  it('期間の指定が不正なら 400 を返す', async () => {
    const response = await createTestApp().request(
      `/api/work-schedules?employeeId=${fixture.employeeId}&from=2026-04-10&to=2026-04-01`,
      authorized(fixture.adminCookie),
    );
    expect(response.status).toBe(400);
  });

  it('存在しない従業員には予定を作れない', async () => {
    const response = await createTestApp().request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: '00000000-0000-4000-8000-000000000000',
          businessDate: '2026-04-01',
          startMinutes: 540,
          endMinutes: 1080,
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('従業員ロールは予定を登録できない', async () => {
    const response = await createTestApp().request(
      '/api/work-schedules',
      authorized(fixture.employeeCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          startMinutes: 540,
          endMinutes: 1080,
        },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('勤怠計算', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('打刻のたびに計算結果が保存される', async () => {
    // Asia/Tokyo の 2026-04-01 09:00 と 18:00。
    const clockIn = createTestApp({ now: '2026-04-01T00:00:00.000Z' });
    await punch(clockIn, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'calc-clock-in',
      occurredAt: '2026-04-01T00:00:00.000Z',
    });

    const clockOut = createTestApp({ now: '2026-04-01T09:00:00.000Z' });
    const result = await punch(clockOut, fixture.employeeCookie, {
      eventType: 'clock_out',
      requestId: 'calc-clock-out',
      occurredAt: '2026-04-01T09:00:00.000Z',
    });

    expect(result.day.calculation).not.toBeNull();
    expect(result.day.calculation?.workedMinutes).toBe(9 * 60);
    expect(result.day.calculation?.version).toBe(2);
    expect(result.day.calculation?.ruleVersion).toBe('v1');
    expect(result.day.calculation?.basis.steps.length).toBeGreaterThan(0);
  });

  it('予定を登録すると所定内と所定外に分かれる', async () => {
    const instance = createTestApp();
    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          startMinutes: 540,
          endMinutes: 1080,
          breakMinutes: 60,
        },
      }),
    );

    // 08:00 出勤、20:00 退勤（Asia/Tokyo）。
    const morning = createTestApp({ now: '2026-03-31T23:00:00.000Z' });
    await punch(morning, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'schedule-clock-in',
      occurredAt: '2026-03-31T23:00:00.000Z',
    });

    const evening = createTestApp({ now: '2026-04-01T11:00:00.000Z' });
    const result = await punch(evening, fixture.employeeCookie, {
      eventType: 'clock_out',
      requestId: 'schedule-clock-out',
      occurredAt: '2026-04-01T11:00:00.000Z',
    });

    expect(result.day.calculation?.workedMinutes).toBe(12 * 60);
    expect(result.day.calculation?.withinScheduleMinutes).toBe(9 * 60);
    expect(result.day.calculation?.outsideScheduleMinutes).toBe(3 * 60);
    expect(result.day.calculation?.scheduledMinutes).toBe(8 * 60);
  });

  it('予定を変えると計算の版が増える', async () => {
    const instance = createTestApp({ now: '2026-04-01T09:00:00.000Z' });
    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'version-clock-in',
      occurredAt: '2026-04-01T00:00:00.000Z',
    });
    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_out',
      requestId: 'version-clock-out',
      occurredAt: '2026-04-01T09:00:00.000Z',
    });

    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-01',
          startMinutes: 540,
          endMinutes: 1080,
          breakMinutes: 60,
        },
      }),
    );

    const response = await instance.request(
      '/api/attendance/days/2026-04-01',
      authorized(fixture.employeeCookie),
    );
    const day = (await response.json()) as WorkDay;

    expect(day.calculation?.version).toBe(3);
    // 休憩を打刻していないため、実労働 9 時間はすべて所定内に入る。
    // 所定労働 8 時間は、所定休憩 60 分を差し引いた値。
    expect(day.calculation?.withinScheduleMinutes).toBe(9 * 60);
    expect(day.calculation?.scheduledMinutes).toBe(8 * 60);

    const versions = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_calculations',
    );
    expect(versions[0]?.count).toBe(3);
  });

  it('入力が変わらなければ版は増えない', async () => {
    const instance = createTestApp({ now: '2026-04-01T09:00:00.000Z' });
    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'same-input-in',
      occurredAt: '2026-04-01T00:00:00.000Z',
    });

    // 同じ冪等キーの再送では計算し直さない。
    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'same-input-in',
      occurredAt: '2026-04-01T00:00:00.000Z',
    });

    const versions = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_calculations',
    );
    expect(versions[0]?.count).toBe(1);
  });

  it('深夜帯と日跨ぎ勤務を数える', async () => {
    // 22:00 出勤、翌 5:00 退勤（Asia/Tokyo）。
    const night = createTestApp({ now: '2026-04-01T13:00:00.000Z' });
    await punch(night, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'night-clock-in',
      occurredAt: '2026-04-01T13:00:00.000Z',
    });

    const morning = createTestApp({ now: '2026-04-01T20:00:00.000Z' });
    const result = await punch(morning, fixture.employeeCookie, {
      eventType: 'clock_out',
      requestId: 'night-clock-out',
      occurredAt: '2026-04-01T20:00:00.000Z',
    });

    expect(result.event.businessDate).toBe('2026-04-01');
    expect(result.day.calculation?.workedMinutes).toBe(7 * 60);
    expect(result.day.calculation?.nightMinutes).toBe(7 * 60);
  });

  it('休日に働いた時間は休日労働として数える', async () => {
    const instance = createTestApp({ now: '2026-04-05T09:00:00.000Z' });
    await instance.request(
      '/api/work-schedules',
      authorized(fixture.adminCookie, {
        method: 'PUT',
        body: {
          employeeId: fixture.employeeId,
          businessDate: '2026-04-05',
          dayType: 'non_working_day',
        },
      }),
    );

    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'holiday-clock-in',
      occurredAt: '2026-04-05T01:00:00.000Z',
    });
    const result = await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_out',
      requestId: 'holiday-clock-out',
      occurredAt: '2026-04-05T06:00:00.000Z',
    });

    expect(result.day.calculation?.nonWorkingDayMinutes).toBe(5 * 60);
    expect(result.day.calculation?.scheduledMinutes).toBe(0);
    expect(result.day.calculation?.basis.dayType).toBe('non_working_day');
  });

  it('打刻を修正すると計算がやり直される', async () => {
    const instance = createTestApp({ now: '2026-04-01T09:00:00.000Z' });
    const clockIn = await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'recalc-clock-in',
      occurredAt: '2026-04-01T00:00:00.000Z',
    });
    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_out',
      requestId: 'recalc-clock-out',
      occurredAt: '2026-04-01T09:00:00.000Z',
    });

    const corrected = await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'adjust',
          targetEventId: clockIn.event.id,
          occurredAt: '2026-04-01T01:00:00.000Z',
          reason: '実際の出勤時刻に合わせるため',
          requestId: 'recalc-correction',
        },
      }),
    );
    const day = ((await corrected.json()) as { day: WorkDay }).day;

    expect(day.calculation?.workedMinutes).toBe(8 * 60);
    expect(day.calculation?.version).toBe(3);
  });

  it('計算結果は書き換えられない', async () => {
    const instance = createTestApp({ now: '2026-04-01T09:00:00.000Z' });
    await punch(instance, fixture.employeeCookie, {
      eventType: 'clock_in',
      requestId: 'immutable-calc-in',
      occurredAt: '2026-04-01T00:00:00.000Z',
    });

    await expect(
      testDatabase().query('UPDATE attendance_calculations SET worked_minutes = 0'),
    ).rejects.toThrow(/追記のみ/);
  });
});
