/**
 * 従業員データの閲覧範囲。
 *
 * 「見えてはいけないものが見えない」ことを確かめるための負のテスト。
 * 一つのワークスペースに 2 つの組織を置き、次の 4 者から同じ経路を叩く。
 *
 * - ワークスペース管理者: 全体を見られる
 * - 組織 A の管理者: 組織 A に関わる従業員だけを見られる
 * - 閲覧範囲を持たない組織管理者: 管理対象を持たない
 * - 一般従業員: 自分だけを見られる
 */
import type {
  AnomalyList,
  AssignmentContractRecord,
  CardCredentialList,
  DailyRequestList,
  DailyRequestRecord,
  EmployeeAssignmentList,
  EmployeeList,
  EmployeeWorkCycleList,
  MonthlyClosingList,
  SessionObservationList,
  WorkCycleRecord,
  WorkPattern,
  WorkScheduleList,
} from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
} from '../support/fixtures.js';

const CLOCK_IN_AT = '2026-04-01T00:00:00.000Z';
const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z';
const BUSINESS_DATE = '2026-04-01';
const PERIOD = '2026-04-01';
const RANGE = 'from=2026-04-01&to=2026-04-30';
/** 締めの期間はその月の 1 日で表す。 */
const CLOSING_RANGE = 'from=2026-04-01&to=2026-05-01';

function app(now: string = CLOCK_OUT_AT) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(now),
  });
}

type App = ReturnType<typeof app>;

interface Fixture {
  workspaceId: string;
  organizationAId: string;
  organizationBId: string;
  /** 受入組織。従業員 B が配属される。雇用元ではない。 */
  organizationHId: string;
  employeeAId: string;
  employeeBId: string;
  /** 閲覧範囲を持たない組織管理者に紐づく従業員。組織 B に属する。 */
  employeeCId: string;
  adminCookie: string;
  managerACookie: string;
  /** 受入組織 H だけを閲覧範囲に持つ管理者。従業員 B とは配属だけで繋がる。 */
  managerHCookie: string;
  /** 閲覧範囲を一件も持たない組織管理者。従業員は紐づいていない。 */
  unscopedManagerCookie: string;
  /** 閲覧範囲を持たないが、自分自身は従業員である組織管理者。 */
  unscopedManagerWithEmployeeCookie: string;
  employeeACookie: string;
  workPatternId: string;
  workCycleId: string;
}

/**
 * 準備の各段階が成功したことを確かめる。
 *
 * 準備が黙って失敗すると、認可の検証が「そもそもデータが無いから空」になり、
 * 絞り込みを外しても気付けなくなる。
 */
async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${what} に失敗しました: ${response.status} ${await response.clone().text()}`);
  }
  return response;
}

async function punch(
  instance: App,
  cookie: string,
  eventType: string,
  requestId: string,
  occurredAt: string,
): Promise<void> {
  await expectOk(
    await instance.request(
      '/api/attendance/events',
      authorized(cookie, { method: 'POST', body: { eventType, requestId, occurredAt } }),
    ),
    `${eventType} の打刻`,
  );
}

/** 打刻から締めまでを一通り行い、認可を確かめる対象データを揃える。 */
async function workAndClose(
  instance: App,
  adminCookie: string,
  employeeCookie: string,
  employeeId: string,
  suffix: string,
): Promise<void> {
  // 冪等キーは 8 文字以上でなければ受け付けられない。
  await punch(instance, employeeCookie, 'clock_in', `clock-in-${suffix}`, CLOCK_IN_AT);
  await punch(instance, employeeCookie, 'clock_out', `clock-out-${suffix}`, CLOCK_OUT_AT);

  const submitted = await expectOk(
    await instance.request(
      '/api/attendance/requests',
      authorized(employeeCookie, { method: 'POST', body: { businessDate: BUSINESS_DATE } }),
    ),
    '日次申請の提出',
  );
  const request = (await submitted.json()) as DailyRequestRecord;

  await expectOk(
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(adminCookie, { method: 'POST', body: {} }),
    ),
    '日次申請の承認',
  );
  await expectOk(
    await instance.request(
      '/api/monthly-closings/close',
      authorized(adminCookie, { method: 'POST', body: { employeeId, period: PERIOD } }),
    ),
    '月次締め',
  );
}

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationAId = await createOrganization(db, workspaceId, { code: 'ORG-A' });
  const organizationBId = await createOrganization(db, workspaceId, { code: 'ORG-B' });
  const organizationHId = await createOrganization(db, workspaceId, { code: 'ORG-H' });

  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });

  const managerAUserId = await createUser(db, workspaceId, {
    email: 'manager-a@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, {
    userId: managerAUserId,
    organizationId: organizationAId,
  });

  // 受入組織側の管理者。従業員を雇用しておらず、配属だけで繋がる。
  const managerHUserId = await createUser(db, workspaceId, {
    email: 'manager-h@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, {
    userId: managerHUserId,
    organizationId: organizationHId,
  });

  // 閲覧範囲をまだ与えられていない組織管理者。
  await createUser(db, workspaceId, {
    email: 'unscoped@example.com',
    roles: ['organization_manager'],
  });

  const employeeA = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: organizationAId,
    employeeNumber: 'E001',
    displayName: '組織A 花子',
    email: 'a@example.com',
  });
  const employeeB = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: organizationBId,
    employeeNumber: 'E002',
    displayName: '組織B 次郎',
    email: 'b@example.com',
  });
  // 閲覧範囲は持たないが、自分自身は従業員である組織管理者。
  const employeeC = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: organizationBId,
    employeeNumber: 'E003',
    displayName: '組織B 三郎',
    email: 'c@example.com',
    roles: ['organization_manager'],
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

  const cycle = (await (
    await instance.request(
      '/api/work-cycles',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          code: 'WEEKDAY',
          name: '平日勤務',
          cycleLength: 7,
          days: [
            { position: 0, dayType: 'working_day', workPatternId: pattern.id },
            { position: 1, dayType: 'working_day', workPatternId: pattern.id },
            { position: 2, dayType: 'working_day', workPatternId: pattern.id },
            { position: 3, dayType: 'working_day', workPatternId: pattern.id },
            { position: 4, dayType: 'working_day', workPatternId: pattern.id },
            { position: 5, dayType: 'non_working_day' },
            { position: 6, dayType: 'non_working_day' },
          ],
        },
      }),
    )
  ).json()) as WorkCycleRecord;

  return {
    workspaceId,
    organizationAId,
    organizationBId,
    organizationHId,
    employeeAId: employeeA.employeeId,
    employeeBId: employeeB.employeeId,
    employeeCId: employeeC.employeeId,
    adminCookie,
    managerACookie: await loginAndGetCookie(instance, { email: 'manager-a@example.com' }),
    managerHCookie: await loginAndGetCookie(instance, { email: 'manager-h@example.com' }),
    unscopedManagerCookie: await loginAndGetCookie(instance, { email: 'unscoped@example.com' }),
    unscopedManagerWithEmployeeCookie: await loginAndGetCookie(instance, {
      email: 'c@example.com',
    }),
    employeeACookie: await loginAndGetCookie(instance, { email: 'a@example.com' }),
    workPatternId: pattern.id,
    workCycleId: cycle.id,
  };
}

/** 契約を作り、従業員を配属する。 */
async function assign(
  instance: App,
  fixture: Fixture,
  input: {
    code: string;
    employerOrganizationId: string;
    hostOrganizationId: string;
    employeeId: string;
  },
): Promise<void> {
  const created = await expectOk(
    await instance.request(
      '/api/assignment-contracts',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          code: input.code,
          name: `${input.code} の契約`,
          employerOrganizationId: input.employerOrganizationId,
          hostOrganizationId: input.hostOrganizationId,
          startsOn: BUSINESS_DATE,
        },
      }),
    ),
    `契約 ${input.code} の登録`,
  );
  const contract = (await created.json()) as AssignmentContractRecord;

  await expectOk(
    await instance.request(
      '/api/employee-assignments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: input.employeeId,
          assignmentContractId: contract.id,
          startsOn: BUSINESS_DATE,
        },
      }),
    ),
    `契約 ${input.code} への配属`,
  );
}

/** 従業員 A・B・C について、認可を確かめる対象データを揃える。 */
async function prepareData(fixture: Fixture): Promise<void> {
  const db = testDatabase();
  const instance = app();

  const cookieA = fixture.employeeACookie;
  const cookieB = await loginAndGetCookie(instance, { email: 'b@example.com' });
  const cookieC = fixture.unscopedManagerWithEmployeeCookie;

  await workAndClose(instance, fixture.adminCookie, cookieA, fixture.employeeAId, 'a');
  await workAndClose(instance, fixture.adminCookie, cookieB, fixture.employeeBId, 'b');
  await workAndClose(instance, fixture.adminCookie, cookieC, fixture.employeeCId, 'c');

  // 従業員 A は組織 A の中で完結する。
  await assign(instance, fixture, {
    code: 'C-A',
    employerOrganizationId: fixture.organizationAId,
    hostOrganizationId: fixture.organizationAId,
    employeeId: fixture.employeeAId,
  });
  // 従業員 B は組織 B に雇用され、受入組織 H へ配属される。
  // 組織 H の管理者は、雇用元ではなくこの配属を根拠に B を見られる。
  await assign(instance, fixture, {
    code: 'C-BH',
    employerOrganizationId: fixture.organizationBId,
    hostOrganizationId: fixture.organizationHId,
    employeeId: fixture.employeeBId,
  });

  for (const employeeId of [fixture.employeeAId, fixture.employeeBId, fixture.employeeCId]) {
    // IC カードの登録は端末の署名を要するが、ここで確かめたいのは一覧の認可なので直接入れる。
    await db.query(
      `INSERT INTO card_credentials (workspace_id, employee_id, fingerprint, label)
       VALUES ($1, $2, $3, $4)`,
      [fixture.workspaceId, employeeId, employeeId.replaceAll('-', '').padEnd(64, '0'), '社員証'],
    );
  }

  for (const employeeId of [fixture.employeeAId, fixture.employeeBId]) {
    await expectOk(
      await instance.request(
        '/api/work-schedules',
        authorized(fixture.adminCookie, {
          method: 'PUT',
          body: {
            employeeId,
            businessDate: BUSINESS_DATE,
            workPatternId: fixture.workPatternId,
          },
        }),
      ),
      '勤務予定の登録',
    );
    await expectOk(
      await instance.request(
        '/api/employee-work-cycles',
        authorized(fixture.adminCookie, {
          method: 'POST',
          body: {
            employeeId,
            workCycleId: fixture.workCycleId,
            anchorDate: BUSINESS_DATE,
            effectiveFrom: BUSINESS_DATE,
          },
        }),
      ),
      '勤務周期の割当',
    );

    // PC の利用記録は端末から届くが、ここで確かめたいのは認可なので直接入れる。
    await db.query(
      `INSERT INTO workstation_session_observations
         (workspace_id, employee_id, observation_type, occurred_at, business_date,
          request_id, workstation_name)
       VALUES ($1, $2, 'sign_in', $3::timestamptz, $4::date, $5, 'PC-01')`,
      [fixture.workspaceId, employeeId, CLOCK_IN_AT, BUSINESS_DATE, `observation-${employeeId}`],
    );

    // 確定後の変更として検出させ、異常の一覧に両者が載るようにする。
    await db.query(
      `INSERT INTO attendance_events
         (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
       VALUES ($1, $2, 'break_start', $3::timestamptz, $4::date, 'web', $5)`,
      [
        fixture.workspaceId,
        employeeId,
        '2026-04-01T05:00:00.000Z',
        BUSINESS_DATE,
        `sneaked-${employeeId}`,
      ],
    );
  }
}

function employeeNumbersOf(body: EmployeeList): string[] {
  return body.employees.map((employee) => employee.employeeNumber).sort();
}

/** CSV から従業員番号の列を取り出す。列の位置は見出しから決める。 */
function csvEmployeeNumbers(csv: string): string[] {
  const [header, ...lines] = csv.trim().split('\n');
  const columns = (header ?? '').split(',').map((value) => value.replaceAll('"', ''));
  const index = columns.indexOf('employee_number');
  if (index < 0) throw new Error('employee_number の列が見つかりません');

  const numbers = lines
    .map((line) => line.split(',')[index]?.replaceAll('"', '') ?? '')
    .filter((value) => value.length > 0);
  return [...new Set(numbers)].sort();
}

describe('従業員データの閲覧範囲', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await prepareData(fixture);
  });

  describe('ワークスペース管理者', () => {
    it('従業員一覧に両方の組織の従業員が現れる', async () => {
      const response = await app().request('/api/employees', authorized(fixture.adminCookie));
      expect(employeeNumbersOf((await response.json()) as EmployeeList)).toEqual([
        'E001',
        'E002',
        'E003',
      ]);
    });

    it('勤怠 CSV に両方の組織の従業員が含まれる', async () => {
      const response = await app().request(
        `/api/exports/attendance.csv?${RANGE}`,
        authorized(fixture.adminCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E001', 'E002', 'E003']);
    });

    it('給与 CSV に両方の組織の従業員が含まれる', async () => {
      const response = await app().request(
        `/api/exports/payroll.csv?period=${PERIOD}`,
        authorized(fixture.adminCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E001', 'E002', 'E003']);
    });

    it('配属の一覧に両方の配属が現れる', async () => {
      const response = await app().request(
        '/api/employee-assignments',
        authorized(fixture.adminCookie),
      );
      const body = (await response.json()) as EmployeeAssignmentList;
      expect(body.assignments.map((assignment) => assignment.employeeId).sort()).toEqual(
        [fixture.employeeAId, fixture.employeeBId].sort(),
      );
    });

    it('IC カードの資格情報に全員分が現れる', async () => {
      const response = await app().request(
        '/api/card-credentials',
        authorized(fixture.adminCookie),
      );
      const body = (await response.json()) as CardCredentialList;
      expect(body.cardCredentials.map((credential) => credential.employeeId).sort()).toEqual(
        [fixture.employeeAId, fixture.employeeBId, fixture.employeeCId].sort(),
      );
    });
  });

  describe('組織 A の管理者', () => {
    it('従業員一覧に組織 A の従業員だけが現れる', async () => {
      const response = await app().request('/api/employees', authorized(fixture.managerACookie));
      expect(employeeNumbersOf((await response.json()) as EmployeeList)).toEqual(['E001']);
    });

    it('日次申請の一覧に組織 B の従業員が現れない', async () => {
      const response = await app().request(
        `/api/attendance/requests?${RANGE}`,
        authorized(fixture.managerACookie),
      );
      const body = (await response.json()) as DailyRequestList;
      expect(body.requests.map((request) => request.employeeId)).toEqual([fixture.employeeAId]);
    });

    it('月次締めの一覧に組織 B の従業員が現れない', async () => {
      const response = await app().request(
        `/api/monthly-closings?${CLOSING_RANGE}`,
        authorized(fixture.managerACookie),
      );
      const body = (await response.json()) as MonthlyClosingList;
      expect(body.closings.map((closing) => closing.employeeId)).toEqual([fixture.employeeAId]);
    });

    it('組織 B の従業員の勤務予定は取得できない', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeBId}&${RANGE}`,
        authorized(fixture.managerACookie),
      );
      expect(response.status).toBe(403);
    });

    it('組織 A の従業員の勤務予定は取得できる', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeAId}&${RANGE}`,
        authorized(fixture.managerACookie),
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as WorkScheduleList).workSchedules).not.toHaveLength(0);
    });

    it('組織 B の従業員の勤務周期割当は取得できない', async () => {
      const response = await app().request(
        `/api/employee-work-cycles?employeeId=${fixture.employeeBId}`,
        authorized(fixture.managerACookie),
      );
      expect(response.status).toBe(403);
    });

    it('組織 A の従業員の勤務周期割当は取得できる', async () => {
      const response = await app().request(
        `/api/employee-work-cycles?employeeId=${fixture.employeeAId}`,
        authorized(fixture.managerACookie),
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as EmployeeWorkCycleList).assignments).not.toHaveLength(0);
    });

    it('PC の利用記録の一覧に組織 B の従業員が現れない', async () => {
      const response = await app().request(
        `/api/session-observations?${RANGE}`,
        authorized(fixture.managerACookie),
      );
      const body = (await response.json()) as SessionObservationList;
      expect(body.observations.map((observation) => observation.employeeId)).toEqual([
        fixture.employeeAId,
      ]);
    });

    it('組織 B の従業員の乖離は取得できない', async () => {
      const response = await app().request(
        `/api/attendance/days/${BUSINESS_DATE}/discrepancies?employeeId=${fixture.employeeBId}`,
        authorized(fixture.managerACookie),
      );
      expect(response.status).toBe(403);
    });

    it('異常の一覧に組織 B の従業員が現れない', async () => {
      const response = await app().request(
        `/api/audit/anomalies?${RANGE}`,
        authorized(fixture.managerACookie),
      );
      const body = (await response.json()) as AnomalyList;
      const employeeIds = new Set(
        body.anomalies
          .map((anomaly) => anomaly.employeeId)
          .filter((value): value is string => value !== null),
      );
      expect([...employeeIds]).toEqual([fixture.employeeAId]);
    });

    it('配属の一覧が組織 A の従業員の分だけになる', async () => {
      const response = await app().request(
        '/api/employee-assignments',
        authorized(fixture.managerACookie),
      );
      const body = (await response.json()) as EmployeeAssignmentList;
      // 「B が無い」だけでなく「A がある」ことも確かめる。
      // 空配列でも通る検証にすると、絞り込みを外しても気付けない。
      expect(body.assignments.map((assignment) => assignment.employeeId)).toEqual([
        fixture.employeeAId,
      ]);
    });

    it('IC カードの資格情報が組織 A の従業員の分だけになる', async () => {
      const response = await app().request(
        '/api/card-credentials',
        authorized(fixture.managerACookie),
      );
      const body = (await response.json()) as CardCredentialList;
      expect(body.cardCredentials.map((credential) => credential.employeeId)).toEqual([
        fixture.employeeAId,
      ]);
    });

    it('勤怠 CSV に組織 B の従業員が含まれない', async () => {
      const response = await app().request(
        `/api/exports/attendance.csv?${RANGE}`,
        authorized(fixture.managerACookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E001']);
    });

    it('給与 CSV に組織 B の従業員が含まれない', async () => {
      const response = await app().request(
        `/api/exports/payroll.csv?period=${PERIOD}`,
        authorized(fixture.managerACookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E001']);
    });
  });

  describe('閲覧範囲を持たない組織管理者', () => {
    it('従業員一覧が空になる', async () => {
      const response = await app().request(
        '/api/employees',
        authorized(fixture.unscopedManagerCookie),
      );
      expect(employeeNumbersOf((await response.json()) as EmployeeList)).toEqual([]);
    });

    it('日次申請の一覧が空になる', async () => {
      const response = await app().request(
        `/api/attendance/requests?${RANGE}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(((await response.json()) as DailyRequestList).requests).toEqual([]);
    });

    it('月次締めの一覧が空になる', async () => {
      const response = await app().request(
        `/api/monthly-closings?${CLOSING_RANGE}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(((await response.json()) as MonthlyClosingList).closings).toEqual([]);
    });

    it('PC の利用記録の一覧が空になる', async () => {
      const response = await app().request(
        `/api/session-observations?${RANGE}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(((await response.json()) as SessionObservationList).observations).toEqual([]);
    });

    it('他の従業員の勤務予定は取得できない', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeAId}&${RANGE}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(response.status).toBe(403);
    });

    it('他の従業員の乖離は取得できない', async () => {
      const response = await app().request(
        `/api/attendance/days/${BUSINESS_DATE}/discrepancies?employeeId=${fixture.employeeAId}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(response.status).toBe(403);
    });

    it('異常の一覧に従業員の行が現れない', async () => {
      const response = await app().request(
        `/api/audit/anomalies?${RANGE}`,
        authorized(fixture.unscopedManagerCookie),
      );
      const body = (await response.json()) as AnomalyList;
      expect(body.anomalies.filter((anomaly) => anomaly.employeeId !== null)).toEqual([]);
    });

    it('勤怠 CSV が全件にならない', async () => {
      const response = await app().request(
        `/api/exports/attendance.csv?${RANGE}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual([]);
    });

    it('給与 CSV が全件にならない', async () => {
      const response = await app().request(
        `/api/exports/payroll.csv?period=${PERIOD}`,
        authorized(fixture.unscopedManagerCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual([]);
    });

    it('他人の IC カードの資格情報は見えない', async () => {
      const response = await app().request(
        '/api/card-credentials',
        authorized(fixture.unscopedManagerCookie),
      );
      const body = (await response.json()) as CardCredentialList;
      expect(body.cardCredentials).toEqual([]);
    });

    it('自分自身の IC カードの資格情報だけは見られる', async () => {
      const response = await app().request(
        '/api/card-credentials',
        authorized(fixture.unscopedManagerWithEmployeeCookie),
      );
      const body = (await response.json()) as CardCredentialList;
      expect(body.cardCredentials.map((credential) => credential.employeeId)).toEqual([
        fixture.employeeCId,
      ]);
    });

    it('勤怠 CSV が自分の行だけになる', async () => {
      const response = await app().request(
        `/api/exports/attendance.csv?${RANGE}`,
        authorized(fixture.unscopedManagerWithEmployeeCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E003']);
    });

    it('給与 CSV が自分の行だけになる', async () => {
      const response = await app().request(
        `/api/exports/payroll.csv?period=${PERIOD}`,
        authorized(fixture.unscopedManagerWithEmployeeCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E003']);
    });

    it('自分自身に従業員が紐づいていれば自分のデータだけを見られる', async () => {
      const response = await app().request(
        '/api/employees',
        authorized(fixture.unscopedManagerWithEmployeeCookie),
      );
      expect(employeeNumbersOf((await response.json()) as EmployeeList)).toEqual(['E003']);
    });

    it('自分自身の勤務予定は取得できる', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeCId}&${RANGE}`,
        authorized(fixture.unscopedManagerWithEmployeeCookie),
      );
      expect(response.status).toBe(200);
    });
  });

  // 受入組織の管理者は、従業員を雇用していない。配属だけを根拠に閲覧できる。
  // CSV は SQL 側で絞り込むため、インメモリの判定とは別実装になる。
  // 両者が食い違うと、画面で隠した相手が CSV から読めてしまう。
  describe('受入組織 H の管理者', () => {
    it('従業員一覧に配属された従業員が現れる', async () => {
      const response = await app().request('/api/employees', authorized(fixture.managerHCookie));
      expect(employeeNumbersOf((await response.json()) as EmployeeList)).toEqual(['E002']);
    });

    it('勤怠 CSV に配属された従業員が含まれ、無関係な従業員は含まれない', async () => {
      const response = await app().request(
        `/api/exports/attendance.csv?${RANGE}`,
        authorized(fixture.managerHCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E002']);
    });

    it('給与 CSV に配属された従業員が含まれ、無関係な従業員は含まれない', async () => {
      const response = await app().request(
        `/api/exports/payroll.csv?period=${PERIOD}`,
        authorized(fixture.managerHCookie),
      );
      expect(csvEmployeeNumbers(await response.text())).toEqual(['E002']);
    });

    it('雇用元が無関係な従業員の勤務予定は取得できない', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeAId}&${RANGE}`,
        authorized(fixture.managerHCookie),
      );
      expect(response.status).toBe(403);
    });

    it('配属された従業員の勤務予定は取得できる', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeBId}&${RANGE}`,
        authorized(fixture.managerHCookie),
      );
      expect(response.status).toBe(200);
    });
  });

  describe('一般従業員', () => {
    it('他の従業員を指定した勤務予定は 403 になる', async () => {
      const response = await app().request(
        `/api/work-schedules?employeeId=${fixture.employeeBId}&${RANGE}`,
        authorized(fixture.employeeACookie),
      );
      expect(response.status).toBe(403);
    });

    it('他の従業員を指定した勤務周期割当は 403 になる', async () => {
      const response = await app().request(
        `/api/employee-work-cycles?employeeId=${fixture.employeeBId}`,
        authorized(fixture.employeeACookie),
      );
      expect(response.status).toBe(403);
    });

    it('他の従業員を指定した乖離は 403 になる', async () => {
      const response = await app().request(
        `/api/attendance/days/${BUSINESS_DATE}/discrepancies?employeeId=${fixture.employeeBId}`,
        authorized(fixture.employeeACookie),
      );
      expect(response.status).toBe(403);
    });

    it('従業員一覧は閲覧できない', async () => {
      const response = await app().request('/api/employees', authorized(fixture.employeeACookie));
      expect(response.status).toBe(403);
    });

    it('勤怠 CSV は閲覧できない', async () => {
      const response = await app().request(
        `/api/exports/attendance.csv?${RANGE}`,
        authorized(fixture.employeeACookie),
      );
      expect(response.status).toBe(403);
    });

    it('IC カードの資格情報の一覧は閲覧できない', async () => {
      const response = await app().request(
        '/api/card-credentials',
        authorized(fixture.employeeACookie),
      );
      expect(response.status).toBe(403);
    });

    it('自分の PC の利用記録だけを見られる', async () => {
      const response = await app().request(
        `/api/session-observations?${RANGE}`,
        authorized(fixture.employeeACookie),
      );
      const body = (await response.json()) as SessionObservationList;
      expect(body.observations.map((observation) => observation.employeeId)).toEqual([
        fixture.employeeAId,
      ]);
    });

    it('自分の日次申請だけを見られる', async () => {
      const response = await app().request(
        `/api/attendance/requests?${RANGE}`,
        authorized(fixture.employeeACookie),
      );
      const body = (await response.json()) as DailyRequestList;
      expect(body.requests.map((request) => request.employeeId)).toEqual([fixture.employeeAId]);
    });
  });
});
