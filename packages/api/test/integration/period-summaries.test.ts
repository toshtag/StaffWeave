/**
 * 週・清算期間・変形労働の対象期間の集計。
 *
 * ここで固定したいのは 4 つ。
 *
 *   月をまたぐ週で、日を数え落とさず二度も数えないこと
 *   総枠が未設定なら、差を 0 ではなく未設定として返すこと
 *   割当が効いていない日を、期間へ混ぜないこと
 *   締めた月を含む期間の合計が、締めた時点の値と食い違わないこと
 */
import type { MonthlySummaryList, PeriodSummaryList } from '@staffweave/contracts';
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

/** 2026-03-30（月）から 2026-04-03（金）までの 5 日。月をまたぐ 1 週間に収まる。 */
const WEEK_DAYS = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03'] as const;

// 打刻は 24 時間より前へは戻せない。日ごとに時計を動かせないため、
// 打刻ではなく勤務予定と再計算で日次を作る。
const app = testAppFactory({ now: '2026-04-30T14:00:00.000Z' });

interface Fixture {
  workspaceId: string;
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
}

let fixture: Fixture;

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const { employeeId } = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '期間 花子',
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

beforeEach(async () => {
  fixture = await setUp();
});

/** 月曜始まりの週と、法定の週の閾値を持つ計算規則の版を置く。 */
async function ruleVersion(
  instance: TestApp,
  body: Record<string, unknown> = {},
): Promise<Response> {
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

/** 8 時間の所定と、その所定どおりの打刻に相当する日次を作る。 */
async function workedDay(instance: TestApp, businessDate: string): Promise<void> {
  const schedule = await instance.request(
    '/api/work-schedules',
    authorized(fixture.adminCookie, {
      method: 'PUT',
      body: {
        employeeId: fixture.employeeId,
        businessDate,
        dayType: 'working_day',
        startMinutes: 9 * 60,
        endMinutes: 17 * 60,
        breakMinutes: 0,
      },
    }),
  );
  if (schedule.status !== 200) {
    throw new Error(`勤務予定を置けませんでした: ${schedule.status}`);
  }

  // 打刻は時計に縛られるため、直接積む。日次の計算は再計算で作る。
  const db = testDatabase();
  for (const [eventType, hour] of [
    ['clock_in', 0],
    ['clock_out', 8],
  ] as const) {
    await db.query(
      `INSERT INTO attendance_events
         (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
       VALUES ($1, $2, $3, ($4::date + ($5 || ' hours')::interval) AT TIME ZONE 'Asia/Tokyo',
               $4, 'web', $6)`,
      [
        fixture.workspaceId,
        fixture.employeeId,
        eventType,
        businessDate,
        String(9 + hour),
        `period-${businessDate}-${eventType}`,
      ],
    );
  }
}

async function recalculate(instance: TestApp, from: string, to: string): Promise<void> {
  const response = await instance.request(
    '/api/attendance/recalculations',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { employeeId: fixture.employeeId, from, to },
    }),
  );
  if (response.status !== 200) {
    throw new Error(`再計算できませんでした: ${response.status}`);
  }
}

async function periods(
  instance: TestApp,
  query: { from: string; to: string; kind?: string },
): Promise<PeriodSummaryList['summaries']> {
  const kind = query.kind === undefined ? '' : `&kind=${query.kind}`;
  const response = await instance.request(
    `/api/period-summaries?employeeId=${fixture.employeeId}&from=${query.from}&to=${query.to}${kind}`,
    authorized(fixture.adminCookie),
  );
  if (response.status !== 200) {
    throw new Error(`期間の集計を読めませんでした: ${response.status}`);
  }
  return ((await response.json()) as PeriodSummaryList).summaries;
}

async function assignFlex(
  instance: TestApp,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return instance.request(
    '/api/labor-system-assignments',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: {
        employeeId: fixture.employeeId,
        systemType: 'flex',
        effectiveFrom: '2026-01-01',
        settlementMonths: 3,
        settlementStartsOn: '2026-01-01',
        settlementBasis: 'legal',
        settlementTotalMinutes: 9_000,
        ...body,
      },
    }),
  );
}

describe('週の集計', () => {
  it('月をまたぐ週を 1 つとして数える', async () => {
    const instance = app();
    await ruleVersion(instance);
    for (const businessDate of WEEK_DAYS) await workedDay(instance, businessDate);
    await recalculate(instance, '2026-03-30', '2026-04-03');

    const weeks = await periods(instance, { from: '2026-03-30', to: '2026-04-03', kind: 'week' });

    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({
      kind: 'week',
      from: '2026-03-30',
      to: '2026-04-05',
      workedMinutes: 5 * 8 * 60,
      workedDays: 5,
    });
  });

  it('範囲の途中から読んでも、週の合計は週の頭から数える', async () => {
    const instance = app();
    await ruleVersion(instance);
    for (const businessDate of WEEK_DAYS) await workedDay(instance, businessDate);
    await recalculate(instance, '2026-03-30', '2026-04-03');

    // 4/1（水）から読んでも、その週は 3/30（月）から数える。
    const weeks = await periods(instance, { from: '2026-04-01', to: '2026-04-03', kind: 'week' });

    expect(weeks[0]).toMatchObject({ from: '2026-03-30', workedMinutes: 5 * 8 * 60 });
  });

  it('法定の週の閾値が未設定なら、総枠も差も未設定として返す', async () => {
    const instance = app();
    await ruleVersion(instance);
    await workedDay(instance, '2026-04-01');
    await recalculate(instance, '2026-04-01', '2026-04-01');

    const weeks = await periods(instance, { from: '2026-04-01', to: '2026-04-01', kind: 'week' });

    expect(weeks[0]?.totalMinutes).toBeNull();
    expect(weeks[0]?.differenceMinutes).toBeNull();
  });

  it('法定の週の閾値があれば、超えた分を差として返す', async () => {
    const instance = app();
    await ruleVersion(instance, { weeklyLegalMinutes: 40 * 60 });
    for (const businessDate of WEEK_DAYS) await workedDay(instance, businessDate);
    await recalculate(instance, '2026-03-30', '2026-04-03');

    const weeks = await periods(instance, { from: '2026-03-30', to: '2026-04-03', kind: 'week' });

    // 5 日 × 8 時間 = 40 時間。ちょうど総枠なので差は 0。
    expect(weeks[0]).toMatchObject({ totalMinutes: 40 * 60, differenceMinutes: 0 });
  });
});

describe('清算期間の集計', () => {
  it('割当の清算期間で区切り、総枠との差を返す', async () => {
    const instance = app();
    await ruleVersion(instance);
    expect((await assignFlex(instance)).status).toBe(201);
    for (const businessDate of WEEK_DAYS) await workedDay(instance, businessDate);
    await recalculate(instance, '2026-03-30', '2026-04-03');

    const settlements = await periods(instance, {
      from: '2026-03-01',
      to: '2026-04-30',
      kind: 'settlement',
    });

    expect(settlements).toEqual([
      expect.objectContaining({
        kind: 'settlement',
        laborSystemType: 'flex',
        from: '2026-01-01',
        to: '2026-03-31',
        // 3/30 と 3/31 の 2 日ぶん。
        workedMinutes: 2 * 8 * 60,
        totalMinutes: 9_000,
        differenceMinutes: 2 * 8 * 60 - 9_000,
      }),
      expect.objectContaining({
        kind: 'settlement',
        from: '2026-04-01',
        to: '2026-06-30',
        // 4/1 から 4/3 の 3 日ぶん。
        workedMinutes: 3 * 8 * 60,
      }),
    ]);
  });

  it('割当が始まる前の日は、期間へ入れない', async () => {
    const instance = app();
    await ruleVersion(instance);
    // 4/2 から効く割当。3/30〜4/1 は割当の外。
    expect((await assignFlex(instance, { effectiveFrom: '2026-04-02' })).status).toBe(201);
    for (const businessDate of WEEK_DAYS) await workedDay(instance, businessDate);
    await recalculate(instance, '2026-03-30', '2026-04-03');

    const settlements = await periods(instance, {
      from: '2026-03-01',
      to: '2026-04-30',
      kind: 'settlement',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      from: '2026-04-02',
      to: '2026-06-30',
      // 4/2 と 4/3 の 2 日ぶんだけ。
      workedMinutes: 2 * 8 * 60,
    });
  });

  it('清算期間を持たない制度では、期間を返さない', async () => {
    const instance = app();
    await ruleVersion(instance);
    const assigned = await instance.request(
      '/api/labor-system-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          systemType: 'normal',
          effectiveFrom: '2026-01-01',
        },
      }),
    );
    expect(assigned.status).toBe(201);

    const settlements = await periods(instance, {
      from: '2026-04-01',
      to: '2026-04-30',
      kind: 'settlement',
    });

    expect(settlements).toEqual([]);
  });
});

describe('締め済みの月との整合', () => {
  it('締めた月を含む期間の合計が、締めた時点の値と食い違わない', async () => {
    const instance = app();
    await ruleVersion(instance);
    expect((await assignFlex(instance)).status).toBe(201);
    await workedDay(instance, '2026-04-01');
    await recalculate(instance, '2026-04-01', '2026-04-01');

    // 日次を承認してから締める。
    const submitted = await instance.request(
      '/api/attendance/requests',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { businessDate: '2026-04-01' },
      }),
    );
    const request = (await submitted.json()) as { id: string };
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.adminCookie, { method: 'POST', body: {} }),
    );
    const closed = await instance.request(
      '/api/monthly-closings/close',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, period: '2026-04-01' },
      }),
    );
    expect(closed.status).toBe(200);

    const monthly = await instance.request(
      `/api/monthly-summaries?period=2026-04-01&employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    const { summaries } = (await monthly.json()) as MonthlySummaryList;
    const snapshotMinutes = summaries[0]?.snapshot?.workedMinutes;

    const settlements = await periods(instance, {
      from: '2026-04-01',
      to: '2026-04-30',
      kind: 'settlement',
    });

    expect(snapshotMinutes).toBe(8 * 60);
    expect(settlements[0]?.workedMinutes).toBe(snapshotMinutes);
    expect(settlements[0]?.includesClosedMonth).toBe(true);
  });
});

describe('認可', () => {
  it('従業員は他人の期間の集計を読めない', async () => {
    const db = testDatabase();
    const organizations = await db.query<{ id: string }>('SELECT id FROM organizations LIMIT 1');
    const organizationId = organizations[0]?.id;
    if (!organizationId) throw new Error('組織が見つかりません');
    const other = await createEmployeeWithAccount(db, fixture.workspaceId, {
      organizationId,
      employeeNumber: 'E002',
      displayName: '別の 太郎',
      email: 'taro@example.com',
    });

    const instance = app();
    const response = await instance.request(
      `/api/period-summaries?employeeId=${other.employeeId}&from=2026-04-01&to=2026-04-30`,
      authorized(fixture.employeeCookie),
    );

    expect(response.status).toBe(403);
  });

  it('広すぎる範囲は断る', async () => {
    const instance = app();
    const response = await instance.request(
      `/api/period-summaries?employeeId=${fixture.employeeId}&from=2020-01-01&to=2026-12-31`,
      authorized(fixture.adminCookie),
    );

    expect(response.status).toBe(400);
  });
});

describe('返す期間の全日次を読む', () => {
  /**
   * 清算期間は要求した範囲より広い。要求の範囲だけを読むと、期間の一部しか
   * 足せないまま、期間まるごとの総枠と比べることになる。
   *
   * 要求より前の月に実績を置き、その分が清算期間の合計へ入ることを見る。
   * 要求の範囲だけを読む実装へ戻すと、この検査は落ちる。
   */
  it('要求より前の月の実績も、清算期間の合計へ入る', async () => {
    const instance = app();
    await ruleVersion(instance);
    expect((await assignFlex(instance)).status).toBe(201);

    // 清算期間は 2026-01-01 から 3 か月。要求は 3 月からにする。
    await workedDay(instance, '2026-02-10');
    await workedDay(instance, '2026-03-30');
    await recalculate(instance, '2026-02-10', '2026-03-30');

    const settlements = await periods(instance, {
      from: '2026-03-01',
      to: '2026-03-31',
      kind: 'settlement',
    });

    expect(settlements).toEqual([
      expect.objectContaining({
        from: '2026-01-01',
        to: '2026-03-31',
        // 2/10 と 3/30 の 2 日ぶん。2 月を読み落とすと 1 日ぶんになる。
        workedMinutes: 2 * 8 * 60,
        partial: false,
        differenceMinutes: 2 * 8 * 60 - 9_000,
      }),
    ]);
  });

  it('割当の途中から始まる期間は、切り詰めたことを示し、総枠と比べない', async () => {
    const instance = app();
    await ruleVersion(instance);
    // 清算期間の起算日は 1/1 のまま、割当は 2/1 から効かせる。
    expect((await assignFlex(instance, { effectiveFrom: '2026-02-01' })).status).toBe(201);
    await workedDay(instance, '2026-02-10');
    await recalculate(instance, '2026-02-10', '2026-02-10');

    const settlements = await periods(instance, {
      from: '2026-02-01',
      to: '2026-03-31',
      kind: 'settlement',
    });

    expect(settlements).toEqual([
      expect.objectContaining({
        from: '2026-02-01',
        to: '2026-03-31',
        partial: true,
        // 期間の一部だけの実労働を、期間まるごとの総枠と比べても意味を持たない。
        differenceMinutes: null,
        totalMinutes: 9_000,
      }),
    ]);
  });
});

describe('週の区切りと規則の版', () => {
  it('週の開始曜日が変わる日で、週を区切り直す', async () => {
    const instance = app();
    // 1/1 から月曜始まり、4/8（水）から水曜始まりへ変える。
    await ruleVersion(instance);
    expect(
      (await ruleVersion(instance, { effectiveFrom: '2026-04-08', weekStartsOn: 3 })).status,
    ).toBe(201);

    const weeks = await periods(instance, { from: '2026-04-01', to: '2026-04-15', kind: 'week' });

    expect(weeks.map((week) => [week.from, week.to])).toEqual([
      ['2026-03-30', '2026-04-05'],
      // 切り替え日の前日で閉じる。
      ['2026-04-06', '2026-04-07'],
      ['2026-04-08', '2026-04-14'],
      ['2026-04-15', '2026-04-21'],
    ]);
  });
});
