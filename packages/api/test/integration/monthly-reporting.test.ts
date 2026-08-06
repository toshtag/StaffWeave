/**
 * 月次の集計、締め前の確認、再計算、締めた値の固定。
 *
 * ここで固定したいのは 3 つ。
 *
 *   月次は日次から導き、未設定を 0 に化けさせないこと
 *   締めた時点の値が、あとからの訂正で動かないこと
 *   締めた月は再計算で動かないこと
 *
 * 時間帯・複数の勤務区間・休暇・労働形態も、同じ経路で通るところまで見る。
 */
import type {
  ClosingReadinessList,
  MonthlyClosingRecord,
  MonthlySummaryList,
  RecalculateAttendanceResponse,
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

const PERIOD = '2026-04-01';
/** Asia/Tokyo の 2026-04-01 09:00 と 18:00。 */
const IN_AT = '2026-04-01T00:00:00.000Z';
const OUT_AT = '2026-04-01T09:00:00.000Z';
/** 同じ日の 2 区間目（20:00-22:00）。中抜けのある働き方を見る。 */
const SECOND_IN_AT = '2026-04-01T11:00:00.000Z';
const SECOND_OUT_AT = '2026-04-01T13:00:00.000Z';

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
  await createUser(db, workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const { employeeId } = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '集計 花子',
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
): Promise<Response> {
  return instance.request(
    '/api/attendance/events',
    authorized(fixture.employeeCookie, {
      method: 'POST',
      body: { eventType, requestId, occurredAt },
    }),
  );
}

async function wholeDay(instance: TestApp): Promise<void> {
  await punch(instance, 'clock_in', IN_AT, 'monthly-in-1');
  await punch(instance, 'clock_out', OUT_AT, 'monthly-out-1');
}

async function summaries(instance: TestApp): Promise<MonthlySummaryList['summaries']> {
  const response = await instance.request(
    `/api/monthly-summaries?period=${PERIOD}&employeeId=${fixture.employeeId}`,
    authorized(fixture.adminCookie),
  );
  return ((await response.json()) as MonthlySummaryList).summaries;
}

async function readiness(instance: TestApp): Promise<ClosingReadinessList['readiness']> {
  const response = await instance.request(
    `/api/monthly-closings/readiness?period=${PERIOD}&employeeId=${fixture.employeeId}`,
    authorized(fixture.adminCookie),
  );
  return ((await response.json()) as ClosingReadinessList).readiness;
}

async function approveDay(instance: TestApp, businessDate: string): Promise<void> {
  const submitted = await instance.request(
    '/api/attendance/requests',
    authorized(fixture.employeeCookie, { method: 'POST', body: { businessDate } }),
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

describe('月次の集計', () => {
  it('日次を足し合わせて返す', async () => {
    const instance = app();
    await wholeDay(instance);

    const [summary] = await summaries(instance);

    expect(summary).toMatchObject({
      employeeNumber: 'E001',
      period: PERIOD,
      workedMinutes: 540,
      workedDays: 1,
      countedDays: 1,
      closingState: null,
      snapshot: null,
    });
  });

  it('同じ日の複数の勤務区間をまとめて数える', async () => {
    const instance = app();
    await wholeDay(instance);
    await punch(instance, 'clock_in', SECOND_IN_AT, 'monthly-in-2');
    await punch(instance, 'clock_out', SECOND_OUT_AT, 'monthly-out-2');

    const [summary] = await summaries(instance);

    // 9 時間 + 2 時間。日は 1 日として数える。
    expect(summary).toMatchObject({ workedMinutes: 660, workedDays: 1, countedDays: 1 });
  });

  it('法定の閾値が未設定なら、その区分は 0 ではなく未設定として返す', async () => {
    const instance = app();
    await wholeDay(instance);

    const [summary] = await summaries(instance);

    expect(summary?.legalOvertimeMinutes).toBeNull();
    expect(summary?.workedMinutes).toBe(540);
  });

  it('打刻の無い月は 0 として返す', async () => {
    const [summary] = await summaries(app());

    expect(summary).toMatchObject({ workedMinutes: 0, countedDays: 0, workedDays: 0 });
  });

  it('従業員は自分の集計を見られる', async () => {
    const instance = app();
    await wholeDay(instance);

    const response = await instance.request(
      `/api/monthly-summaries?period=${PERIOD}&employeeId=${fixture.employeeId}`,
      authorized(fixture.employeeCookie),
    );

    expect(response.status).toBe(200);
  });

  it('従業員は他人の集計を見られない', async () => {
    const db = testDatabase();
    const organizations = await db.query<{ id: string }>('SELECT id FROM organizations LIMIT 1');
    const organizationId = organizations[0]?.id;
    if (!organizationId) throw new Error('組織が見つかりません');
    const other = await createEmployeeWithAccount(db, fixture.workspaceId, {
      organizationId,
      employeeNumber: 'E002',
      displayName: '集計 太郎',
      email: 'taro@example.com',
    });

    const response = await app().request(
      `/api/monthly-summaries?period=${PERIOD}&employeeId=${other.employeeId}`,
      authorized(fixture.employeeCookie),
    );

    expect(response.status).toBe(403);
  });
});

describe('締める前の確認', () => {
  it('退勤していない日は、実務が止まるものとして出す', async () => {
    const instance = app();
    await punch(instance, 'clock_in', IN_AT, 'monthly-in-open');

    const [result] = await readiness(instance);

    expect(result?.blocked).toBe(true);
    expect(result?.findings).toContainEqual({
      kind: 'open_work_day',
      severity: 'blocking',
      businessDate: '2026-04-01',
    });
  });

  it('申請していない日は、締めを止めない材料として出す', async () => {
    const instance = app();
    await wholeDay(instance);

    const [result] = await readiness(instance);

    expect(result?.blocked).toBe(false);
    expect(result?.findings).toContainEqual({
      kind: 'not_requested',
      severity: 'advisory',
      businessDate: '2026-04-01',
    });
  });

  it('承認まで済んだ日は何も出さない', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');

    const [result] = await readiness(instance);

    expect(result).toMatchObject({ findings: [], blocked: false });
  });
});

describe('締めた値の固定', () => {
  it('締めると、その時点の集計を固めて返す', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');

    expect((await close(instance)).status).toBe(200);

    const [summary] = await summaries(instance);
    expect(summary?.snapshot).toMatchObject({ sequence: 1, workedMinutes: 540, countedDays: 1 });
    expect(summary?.driftedFromSnapshot).toBe(false);
  });

  it('締めたあとに訂正しても、締めた値は動かない', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');
    await close(instance);

    // 締めを解除しないと訂正できない。解除してから直す。
    await instance.request(
      '/api/monthly-closings/reopen',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD, reason: '打刻の誤り' },
      }),
    );
    const day = await instance.request(
      '/api/attendance/days/2026-04-01',
      authorized(fixture.employeeCookie),
    );
    const events = ((await day.json()) as { events: { id: string; eventType: string }[] }).events;
    const clockOut = events.find((event) => event.eventType === 'clock_out');
    if (clockOut === undefined) throw new Error('退勤の打刻が見つかりません');

    await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'adjust',
          targetEventId: clockOut.id,
          occurredAt: '2026-04-01T10:00:00.000Z',
          reason: '退勤の打刻漏れ',
          requestId: 'monthly-fix-out-1',
        },
      }),
    );

    const [summary] = await summaries(instance);

    // いまの値は 10 時間。締めたときの値は 9 時間のまま。
    expect(summary?.workedMinutes).toBe(600);
    expect(summary?.snapshot).toMatchObject({ workedMinutes: 540 });
    expect(summary?.driftedFromSnapshot).toBe(true);
  });

  it('締め直すと、新しい記録を積む', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');
    await close(instance);
    await instance.request(
      '/api/monthly-closings/reopen',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: PERIOD, reason: '確認のため' },
      }),
    );
    // 解除すると、その月の申請は差し戻しへ戻る。締め直すには承認をやり直す。
    await approveDay(instance, '2026-04-01');
    const second = await close(instance);

    expect(second.status).toBe(200);
    expect(((await second.json()) as MonthlyClosingRecord).state).toBe('closed');

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM monthly_closing_snapshots',
    );
    expect(rows[0]?.count).toBe(2);
  });

  it('固めた記録は書き換えられない', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');
    await close(instance);

    await expect(
      testDatabase().query('UPDATE monthly_closing_snapshots SET worked_minutes = 0'),
    ).rejects.toThrow();
  });

  it('締めた月の給与出力は、締めた値を出す', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');
    await close(instance);

    const response = await instance.request(
      `/api/exports/payroll.csv?period=${PERIOD}`,
      authorized(fixture.adminCookie),
    );
    const csv = await response.text();

    expect(csv.split('\n')[0]).toContain('"snapshot_sequence","closed_at"');
    expect(csv).toContain('"E001"');
    expect(csv).toContain('"closed"');
  });
});

describe('再計算', () => {
  it('入力が変わっていなければ新しい版を作らない', async () => {
    const instance = app();
    await wholeDay(instance);

    const response = await instance.request(
      '/api/attendance/recalculations',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, from: '2026-04-01', to: '2026-04-03' },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as RecalculateAttendanceResponse).toMatchObject({
      examinedDays: 3,
      recalculatedDays: 0,
      skippedClosedDays: [],
    });
  });

  it('締めた月は動かさず、飛ばした日を返す', async () => {
    const instance = app();
    await wholeDay(instance);
    await approveDay(instance, '2026-04-01');
    await close(instance);

    const response = await instance.request(
      '/api/attendance/recalculations',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, from: '2026-04-01', to: '2026-04-02' },
      }),
    );

    const result = (await response.json()) as RecalculateAttendanceResponse;
    expect(result.skippedClosedDays).toEqual(['2026-04-01', '2026-04-02']);
    expect(result.recalculatedDays).toBe(0);
  });

  it('長すぎる期間は受け付けない', async () => {
    const response = await app().request(
      '/api/attendance/recalculations',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, from: '2026-01-01', to: '2026-12-31' },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('従業員は再計算できない', async () => {
    const response = await app().request(
      '/api/attendance/recalculations',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, from: '2026-04-01', to: '2026-04-02' },
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe('まとまった量と、時間帯・休暇・労働形態', () => {
  /** 日次の計算を直接積む。打刻を 1 件ずつ通すより速く、集計の側だけを見られる。 */
  async function seedDays(count: number, minutesPerDay: number): Promise<void> {
    const values: string[] = [];
    const parameters: (string | number)[] = [fixture.workspaceId, fixture.employeeId];
    for (let index = 0; index < count; index += 1) {
      const date = `2026-04-${String(index + 1).padStart(2, '0')}`;
      const base = parameters.length + 1;
      values.push(`($1, $2, $${base}, 1, $${base + 1}, 'test', $${base + 2}, $${base + 2},
        0, 0, 0, 0, 0, 0, 0, 0, '{}'::jsonb)`);
      parameters.push(date, `fingerprint-${date}`, minutesPerDay);
    }
    await testDatabase().query(
      `INSERT INTO attendance_calculations
         (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
          attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
          within_schedule_minutes, outside_schedule_minutes, night_minutes,
          non_working_day_minutes, leave_minutes, absence_minutes, basis)
       VALUES ${values.join(',')}`,
      parameters,
    );
  }

  it('1 か月ぶんの日次をまとめて集計できる', async () => {
    await seedDays(30, 480);

    const [summary] = await summaries(app());

    expect(summary).toMatchObject({
      workedMinutes: 30 * 480,
      workedDays: 30,
      countedDays: 30,
    });
  });

  it('日の始まりを設定すると、日をまたぐ勤務が始めた日の集計へ入る', async () => {
    const instance = app();
    // 日の始まりを 07:00 にすると、翌朝 06:00 の退勤は前日として数える。
    // 設定しないかぎり暦日で切れる。製品は既定値を持たない。
    await instance.request(
      '/api/calculation-rule-versions',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          effectiveFrom: '2026-04-01',
          dayStartMinutes: 7 * 60,
          nightStartMinutes: 22 * 60,
          nightEndMinutes: 5 * 60,
          roundingMinutes: 1,
          roundingMode: 'down',
          weekStartsOn: 0,
          monthStartsOn: 1,
        },
      }),
    );

    // Asia/Tokyo の 2026-04-01 22:00 から翌 06:00 まで。
    // 退勤は「いま」より後になるため、この検査だけ時計を翌朝へ進める。
    const overnight = testAppFactory({ now: '2026-04-01T22:00:00.000Z' })();
    await punch(overnight, 'clock_in', '2026-04-01T13:00:00.000Z', 'overnight-in');
    await punch(overnight, 'clock_out', '2026-04-01T21:00:00.000Z', 'overnight-out');

    const [summary] = await summaries(instance);

    expect(summary).toMatchObject({ workedMinutes: 480, workedDays: 1, countedDays: 1 });
  });

  it('休暇として記録した分は、実労働と別に数える', async () => {
    await testDatabase().query(
      `INSERT INTO attendance_calculations
         (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
          attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
          within_schedule_minutes, outside_schedule_minutes, night_minutes,
          non_working_day_minutes, leave_minutes, absence_minutes, basis)
       VALUES ($1, $2, '2026-04-06', 1, 'leave-day', 'test',
               0, 0, 0, 480, 0, 0, 0, 0, 480, 0, '{}'::jsonb)`,
      [fixture.workspaceId, fixture.employeeId],
    );

    const [summary] = await summaries(app());

    expect(summary).toMatchObject({ workedMinutes: 0, leaveMinutes: 480, leaveDays: 1 });
  });

  it('裁量労働のみなし分数も集計へ入る', async () => {
    await testDatabase().query(
      `INSERT INTO attendance_calculations
         (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
          attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
          within_schedule_minutes, outside_schedule_minutes, night_minutes,
          non_working_day_minutes, leave_minutes, absence_minutes, deemed_minutes, basis)
       VALUES ($1, $2, '2026-04-07', 1, 'deemed-day', 'test',
               300, 300, 0, 480, 300, 0, 0, 0, 0, 0, 480, '{}'::jsonb)`,
      [fixture.workspaceId, fixture.employeeId],
    );

    const [summary] = await summaries(app());

    expect(summary).toMatchObject({ workedMinutes: 300, deemedMinutes: 480 });
  });
});
