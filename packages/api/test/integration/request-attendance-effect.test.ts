/**
 * 承認しきった申請が、日次の勤怠計算へ効くこと。
 *
 * ここで固定したいのは 4 つ。
 *
 *   承認しきるまでは計算が動かないこと
 *   差し戻し・取消・出し直しの途中でも動かないこと
 *   締め済みの期間へは反映せず、承認そのものを断ること
 *   打刻修正の承認が、元の打刻を残したまま効いた打刻を差し替えること
 */
import type { EmployeeRequestRecord, RequestTypeRecord, WorkDay } from '@staffweave/contracts';
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

// 打刻は 24 時間より前へは戻せない。対象日の直後を「いま」として動かす。
const app = testAppFactory({ now: '2026-04-01T14:00:00.000Z' });

interface Fixture {
  workspaceId: string;
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
}

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const { employeeId } = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '認定 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  return {
    workspaceId,
    employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setUp();
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
    throw new Error(`打刻できませんでした: ${response.status}`);
  }
}

/** 09:00–18:00 の所定を置く。所定が無いと、どこからが残業かを決められない。 */
async function scheduleDay(
  instance: TestApp,
  dayType: 'working_day' | 'non_working_day' = 'working_day',
): Promise<void> {
  const response = await instance.request(
    '/api/work-schedules',
    authorized(fixture.adminCookie, {
      method: 'PUT',
      body: {
        employeeId: fixture.employeeId,
        businessDate: BUSINESS_DATE,
        dayType,
        ...(dayType === 'working_day'
          ? { startMinutes: 9 * 60, endMinutes: 18 * 60, breakMinutes: 0 }
          : { breakMinutes: 0 }),
      },
    }),
  );
  if (response.status !== 200) {
    throw new Error(`勤務予定を置けませんでした: ${response.status}`);
  }
}

async function createType(
  instance: TestApp,
  body: Record<string, unknown>,
): Promise<RequestTypeRecord> {
  const response = await instance.request(
    '/api/request-types',
    authorized(fixture.adminCookie, { method: 'POST', body: { approvalSteps: 1, ...body } }),
  );
  if (response.status !== 201) throw new Error(`申請種別を作れませんでした: ${response.status}`);
  return (await response.json()) as RequestTypeRecord;
}

async function submit(
  instance: TestApp,
  type: RequestTypeRecord,
  body: Record<string, unknown> = {},
): Promise<EmployeeRequestRecord> {
  const response = await instance.request(
    '/api/employee-requests',
    authorized(fixture.employeeCookie, {
      method: 'POST',
      body: {
        requestTypeId: type.id,
        employeeId: fixture.employeeId,
        businessDate: BUSINESS_DATE,
        reason: '対応のため',
        ...body,
      },
    }),
  );
  if (response.status !== 201) throw new Error(`申請できませんでした: ${response.status}`);
  return (await response.json()) as EmployeeRequestRecord;
}

async function decide(
  instance: TestApp,
  requestId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return instance.request(
    `/api/employee-requests/${requestId}/decisions`,
    authorized(fixture.adminCookie, { method: 'POST', body }),
  );
}

/**
 * 計算をやり直させる。
 *
 * 日を読むだけでは、保存済みの計算がそのまま返る。
 * 「承認前は効かない」ことを確かめるには、やり直させたうえで
 * 値が動かないところまで見る必要がある。
 */
async function recalculate(instance: TestApp): Promise<void> {
  const response = await instance.request(
    '/api/attendance/recalculations',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { employeeId: fixture.employeeId, from: BUSINESS_DATE, to: BUSINESS_DATE },
    }),
  );
  if (response.status !== 200) {
    throw new Error(`再計算できませんでした: ${response.status}`);
  }
}

async function day(instance: TestApp): Promise<WorkDay> {
  const response = await instance.request(
    `/api/attendance/days/${BUSINESS_DATE}`,
    authorized(fixture.employeeCookie),
  );
  return (await response.json()) as WorkDay;
}

/** 21:00 までの残業を申請する種別。 */
async function overtimeType(instance: TestApp): Promise<RequestTypeRecord> {
  return createType(instance, {
    code: 'OT',
    name: '残業',
    category: 'overtime',
    requiresOvertimeLimit: true,
  });
}

describe('残業の認定', () => {
  it('承認しきるまでは、認定した残業が増えない', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-ot-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-ot-out');

    const type = await createType(instance, {
      code: 'OT',
      name: '残業',
      category: 'overtime',
      requiresOvertimeLimit: true,
      approvalSteps: 2,
    });
    const request = await submit(instance, type, { overtimeLimitMinutes: 21 * 60 });

    // 提出しただけ。やり直させても認定は増えない。
    await recalculate(instance);
    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(0);

    // 1 段目まで。まだ承認しきっていない。
    expect(
      (await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 })).status,
    ).toBe(200);
    await recalculate(instance);
    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(0);

    // 2 段目で承認しきる。
    expect(
      (await decide(instance, request.id, { decision: 'approved', step: 2, submission: 1 })).status,
    ).toBe(200);

    const after = await day(instance);
    // 18:00–21:00 が認定、21:00–22:00 が超過。
    expect(after.calculation?.recognizedOvertimeMinutes).toBe(3 * 60);
    expect(after.calculation?.unapprovedOvertimeMinutes).toBe(60);
  });

  it('差し戻された申請は、計算へ効かない', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-ret-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-ret-out');

    const type = await overtimeType(instance);
    const request = await submit(instance, type, { overtimeLimitMinutes: 21 * 60 });
    await decide(instance, request.id, {
      decision: 'returned',
      step: 1,
      submission: 1,
      comment: '時刻を直してください',
    });
    await recalculate(instance);

    const after = await day(instance);
    expect(after.calculation?.recognizedOvertimeMinutes).toBe(0);
    expect(after.calculation?.unapprovedOvertimeMinutes).toBe(4 * 60);
  });

  it('取り下げた申請は、計算へ効かない', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-cancel-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-cancel-out');

    const type = await overtimeType(instance);
    const request = await submit(instance, type, { overtimeLimitMinutes: 21 * 60 });
    const cancelled = await instance.request(
      `/api/employee-requests/${request.id}/cancellation`,
      authorized(fixture.employeeCookie, { method: 'POST' }),
    );
    expect(cancelled.status).toBe(200);
    await recalculate(instance);

    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(0);
  });

  it('出し直した申請は、承認しきった内容で効く', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-resub-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-resub-out');

    const type = await overtimeType(instance);
    const request = await submit(instance, type, { overtimeLimitMinutes: 20 * 60 });
    await decide(instance, request.id, {
      decision: 'returned',
      step: 1,
      submission: 1,
      comment: '21 時までにしてください',
    });

    // 出し直しで上限を 21:00 へ直す。
    const resubmitted = await instance.request(
      `/api/employee-requests/${request.id}/resubmissions`,
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { overtimeLimitMinutes: 21 * 60 },
      }),
    );
    expect(resubmitted.status).toBe(200);

    // 出し直しただけでは効かない。
    await recalculate(instance);
    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(0);

    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 2 });

    // 差し戻し前の 20:00 ではなく、出し直した 21:00 で認定する。
    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(3 * 60);
  });

  it('計算の版は、承認したときに 1 つだけ増える', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-ver-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-ver-out');

    const before = (await day(instance)).calculation?.version ?? 0;
    const type = await overtimeType(instance);
    const request = await submit(instance, type, { overtimeLimitMinutes: 21 * 60 });
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    expect((await day(instance)).calculation?.version).toBe(before + 1);
  });
});

describe('休日出勤の認定', () => {
  it('承認があれば、休日労働を承認済みとして数える', async () => {
    const instance = app();
    await scheduleDay(instance, 'non_working_day');
    await punch(instance, 'clock_in', IN_AT, 'effect-hol-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-hol-out');

    const before = await day(instance);
    expect(before.calculation?.approvedHolidayMinutes).toBe(0);
    expect(before.calculation?.unapprovedHolidayMinutes).toBe(13 * 60);

    const type = await createType(instance, {
      code: 'HW',
      name: '休日出勤',
      category: 'holiday_work',
    });
    const request = await submit(instance, type);
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    const after = await day(instance);
    expect(after.calculation?.approvedHolidayMinutes).toBe(13 * 60);
    expect(after.calculation?.unapprovedHolidayMinutes).toBe(0);
  });
});

describe('打刻修正の反映', () => {
  async function correctionType(instance: TestApp): Promise<RequestTypeRecord> {
    return createType(instance, {
      code: 'FIX',
      name: '打刻修正',
      category: 'attendance_correction',
      requiresTimeRange: true,
    });
  }

  it('承認しきると、効いた打刻が申請した時刻へ入れ替わる', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-fix-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-fix-out');

    expect((await day(instance)).calculation?.workedMinutes).toBe(13 * 60);

    const type = await correctionType(instance);
    // 09:00–18:00 が正しかった、という申請。
    const request = await submit(instance, type, {
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    });
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    const after = await day(instance);
    expect(after.calculation?.workedMinutes).toBe(9 * 60);
    // 元の打刻は消えていない。取り消す記録と足す記録が積まれている。
    expect(after.history.length).toBeGreaterThan(after.events.length);
    expect(after.history.filter((event) => event.correctionAction === 'void')).toHaveLength(2);
    expect(after.history.filter((event) => event.correctionAction === 'add')).toHaveLength(2);
  });

  it('承認しきるまでは、打刻が入れ替わらない', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-fix2-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-fix2-out');

    const type = await createType(instance, {
      code: 'FIX',
      name: '打刻修正',
      category: 'attendance_correction',
      requiresTimeRange: true,
      approvalSteps: 2,
    });
    const request = await submit(instance, type, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    const after = await day(instance);
    expect(after.calculation?.workedMinutes).toBe(13 * 60);
    expect(after.history.filter((event) => event.correctionAction !== null)).toHaveLength(0);
  });

  it('期間をまたぐ打刻修正は受け付けない', async () => {
    const instance = app();
    await scheduleDay(instance);
    const type = await correctionType(instance);
    const request = await submit(instance, type, {
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
      endsOn: '2026-04-02',
    });

    const response = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
    });

    expect(response.status).toBe(409);
  });
});

describe('締め済みの期間', () => {
  /** 締めるには、その日の日次が承認済みになっている必要がある。 */
  async function approveDay(instance: TestApp): Promise<void> {
    const submitted = await instance.request(
      '/api/attendance/requests',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { businessDate: BUSINESS_DATE },
      }),
    );
    const request = (await submitted.json()) as { id: string };
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.adminCookie, { method: 'POST', body: {} }),
    );
  }

  async function close(instance: TestApp): Promise<Response> {
    return instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD },
      }),
    );
  }

  it('締め済みの日を含む申請は、承認そのものを断る', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-closed-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-closed-out');

    const type = await overtimeType(instance);
    const request = await submit(instance, type, { overtimeLimitMinutes: 21 * 60 });

    await approveDay(instance);
    expect((await close(instance)).status).toBe(200);

    const response = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
    });

    expect(response.status).toBe(409);
    // 断ったので、申請の状態も計算も動かない。
    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(0);
  });

  it('締めを解除すれば、同じ申請を承認できる', async () => {
    const instance = app();
    await scheduleDay(instance);
    await punch(instance, 'clock_in', IN_AT, 'effect-reopen-in');
    await punch(instance, 'clock_out', OUT_AT, 'effect-reopen-out');

    const type = await overtimeType(instance);
    const request = await submit(instance, type, { overtimeLimitMinutes: 21 * 60 });
    await approveDay(instance);
    await close(instance);
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    const reopened = await instance.request(
      '/api/monthly-closings/reopen',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD, reason: '承認のやり直し' },
      }),
    );
    expect(reopened.status).toBe(200);

    const response = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
    });

    expect(response.status).toBe(200);
    expect((await day(instance)).calculation?.recognizedOvertimeMinutes).toBe(3 * 60);
  });
});
