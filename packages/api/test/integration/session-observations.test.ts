import { generateKeyPair, signMessage } from '@staffweave/agent';
import type {
  DiscrepancyReport,
  EnrollDeviceResponse,
  RecordSessionObservationsResponse,
  RegisterDeviceResponse,
  SessionObservationList,
} from '@staffweave/contracts';
import { canonicalSessionObservations } from '@staffweave/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
} from '../support/fixtures.js';

/** Asia/Tokyo の 2026-04-01 における各時刻。 */
const CLOCK_IN_AT = '2026-04-01T00:00:00.000Z'; // 09:00
const BREAK_START_AT = '2026-04-01T03:00:00.000Z'; // 12:00
const BREAK_END_AT = '2026-04-01T04:00:00.000Z'; // 13:00
const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z'; // 18:00
const BUSINESS_DATE = '2026-04-01';

function app(now: string = CLOCK_OUT_AT) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(now),
  });
}

type App = ReturnType<typeof app>;

interface Fixture {
  adminCookie: string;
  employeeCookie: string;
  employeeId: string;
  device: { deviceId: string; privateKeyPem: string };
  sequence: number;
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

  const registered = (await (
    await instance.request(
      '/api/devices',
      authorized(adminCookie, { method: 'POST', body: { name: 'PC 監視' } }),
    )
  ).json()) as RegisterDeviceResponse;

  const keyPair = generateKeyPair();
  const enrolled = (await (
    await instance.request('/api/device-agent/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enrollmentToken: registered.enrollmentToken,
        publicKey: keyPair.publicKeyPem,
      }),
    })
  ).json()) as EnrollDeviceResponse;

  return {
    adminCookie,
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    employeeId: employee.employeeId,
    device: { deviceId: enrolled.deviceId, privateKeyPem: keyPair.privateKeyPem },
    sequence: 1,
  };
}

interface ObservationLine {
  employeeNumber?: string;
  observationType: 'sign_in' | 'sign_out' | 'lock' | 'unlock';
  occurredAt: string;
}

async function sendObservations(
  instance: App,
  fixture: Fixture,
  requestId: string,
  lines: readonly ObservationLine[],
  overrides: { signature?: string } = {},
): Promise<Response> {
  const body = {
    sequence: fixture.sequence,
    requestId,
    workstationName: 'desk-01',
    observations: lines.map((line) => ({
      employeeNumber: line.employeeNumber ?? 'E001',
      observationType: line.observationType,
      occurredAt: line.occurredAt,
    })),
  };
  fixture.sequence += 1;

  const signature =
    overrides.signature ??
    signMessage(
      fixture.device.privateKeyPem,
      canonicalSessionObservations({ deviceId: fixture.device.deviceId, ...body }),
    );

  return instance.request('/api/device-agent/session-observations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': fixture.device.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

async function punch(
  instance: App,
  cookie: string,
  eventType: string,
  requestId: string,
  occurredAt: string,
): Promise<void> {
  await instance.request(
    '/api/attendance/events',
    authorized(cookie, { method: 'POST', body: { eventType, requestId, occurredAt } }),
  );
}

async function report(instance: App, cookie: string): Promise<DiscrepancyReport> {
  const response = await instance.request(
    `/api/attendance/days/${BUSINESS_DATE}/discrepancies`,
    authorized(cookie),
  );
  return (await response.json()) as DiscrepancyReport;
}

describe('PC セッションの観測', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('署名付きでまとめて受け取り、記録できる', async () => {
    const response = await sendObservations(app(), fixture, 'session-batch-1', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
      { observationType: 'sign_out', occurredAt: CLOCK_OUT_AT },
    ]);
    const body = (await response.json()) as RecordSessionObservationsResponse;

    expect(response.status).toBe(201);
    expect(body.accepted).toBe(2);
    expect(body.skipped).toBe(0);
  });

  it('署名が合わなければ受け付けない', async () => {
    const response = await sendObservations(
      app(),
      fixture,
      'session-bad-signature',
      [{ observationType: 'sign_in', occurredAt: CLOCK_IN_AT }],
      { signature: Buffer.from('not a signature').toString('base64') },
    );

    expect(response.status).toBe(401);
  });

  it('同じ冪等キーの再送では記録が増えない', async () => {
    const instance = app();
    const lines: ObservationLine[] = [{ observationType: 'sign_in', occurredAt: CLOCK_IN_AT }];

    const first = await sendObservations(instance, fixture, 'session-idempotent', lines);
    // 再送では連番も同じ値に戻す。
    fixture.sequence -= 1;
    const second = await sendObservations(instance, fixture, 'session-idempotent', lines);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as RecordSessionObservationsResponse).outcome).toBe('duplicate');

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM workstation_session_observations',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('従業員が見つからない観測は対象外として数える', async () => {
    const response = await sendObservations(app(), fixture, 'session-unknown-employee', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
      { employeeNumber: 'E999', observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
    ]);
    const body = (await response.json()) as RecordSessionObservationsResponse;

    expect(body.accepted).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it('観測は書き換えられない', async () => {
    await sendObservations(app(), fixture, 'session-immutable', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
    ]);

    await expect(
      testDatabase().query('DELETE FROM workstation_session_observations'),
    ).rejects.toThrow(/追記のみ/);
  });

  it('観測から打刻は作られない', async () => {
    await sendObservations(app(), fixture, 'session-no-punch', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
      { observationType: 'sign_out', occurredAt: CLOCK_OUT_AT },
    ]);

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('本人は自分の観測を一覧できる', async () => {
    const instance = app();
    await sendObservations(instance, fixture, 'session-list-1', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
    ]);

    const response = await instance.request(
      `/api/session-observations?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`,
      authorized(fixture.employeeCookie),
    );
    const body = (await response.json()) as SessionObservationList;

    expect(response.status).toBe(200);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0]?.workstationName).toBe('desk-01');
  });

  it('従業員は他人の観測を一覧できない', async () => {
    const response = await app().request(
      `/api/session-observations?employeeId=00000000-0000-4000-8000-000000000000&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`,
      authorized(fixture.employeeCookie),
    );
    expect(response.status).toBe(403);
  });
});

describe('勤怠との乖離', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'day-clock-in', CLOCK_IN_AT);
    await punch(instance, fixture.employeeCookie, 'break_start', 'day-break-start', BREAK_START_AT);
    await punch(instance, fixture.employeeCookie, 'break_end', 'day-break-end', BREAK_END_AT);
    await punch(instance, fixture.employeeCookie, 'clock_out', 'day-clock-out', CLOCK_OUT_AT);
  });

  it('打刻と一致していれば乖離は出ない', async () => {
    const instance = app();
    await sendObservations(instance, fixture, 'match-observations', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
      { observationType: 'lock', occurredAt: BREAK_START_AT },
      { observationType: 'unlock', occurredAt: BREAK_END_AT },
      { observationType: 'sign_out', occurredAt: CLOCK_OUT_AT },
    ]);

    expect((await report(instance, fixture.employeeCookie)).discrepancies).toEqual([]);
  });

  it('出勤前と退勤後の利用を根拠つきで示す', async () => {
    const instance = app();
    await sendObservations(instance, fixture, 'outside-observations', [
      // 08:00 にログインし、20:00 にログオフしている。
      { observationType: 'sign_in', occurredAt: '2026-03-31T23:00:00.000Z' },
      { observationType: 'lock', occurredAt: BREAK_START_AT },
      { observationType: 'unlock', occurredAt: BREAK_END_AT },
      { observationType: 'sign_out', occurredAt: '2026-04-01T11:00:00.000Z' },
    ]);

    const body = await report(instance, fixture.employeeCookie);
    const kinds = body.discrepancies.map((entry) => entry.kind);

    expect(kinds).toContain('pc_active_before_clock_in');
    expect(kinds).toContain('pc_active_after_clock_out');
    expect(
      body.discrepancies.find((entry) => entry.kind === 'pc_active_before_clock_in')?.minutes,
    ).toBe(60);
    expect(
      body.discrepancies.find((entry) => entry.kind === 'pc_active_before_clock_in')?.evidence.note,
    ).toContain('出勤の打刻より前');
    expect(body.observations).toHaveLength(4);
  });

  it('休憩中の利用を示す', async () => {
    const instance = app();
    await sendObservations(instance, fixture, 'break-observations', [
      { observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
      { observationType: 'sign_out', occurredAt: CLOCK_OUT_AT },
    ]);

    const body = await report(instance, fixture.employeeCookie);
    expect(body.discrepancies.map((entry) => entry.kind)).toContain('pc_active_during_break');
  });

  it('管理者は従業員を指定して確認できる', async () => {
    const instance = app();
    await sendObservations(instance, fixture, 'admin-observations', [
      { observationType: 'sign_in', occurredAt: '2026-03-31T23:00:00.000Z' },
      { observationType: 'sign_out', occurredAt: CLOCK_OUT_AT },
    ]);

    const response = await instance.request(
      `/api/attendance/days/${BUSINESS_DATE}/discrepancies?employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    const body = (await response.json()) as DiscrepancyReport;

    expect(response.status).toBe(200);
    expect(body.employeeId).toBe(fixture.employeeId);
    expect(body.discrepancies.length).toBeGreaterThan(0);
  });

  it('従業員は他人の乖離を確認できない', async () => {
    const response = await app().request(
      `/api/attendance/days/${BUSINESS_DATE}/discrepancies?employeeId=00000000-0000-4000-8000-000000000000`,
      authorized(fixture.employeeCookie),
    );
    expect(response.status).toBe(403);
  });

  it('業務日の形式が不正なら 400 を返す', async () => {
    const response = await app().request(
      '/api/attendance/days/2026-4-1/discrepancies',
      authorized(fixture.employeeCookie),
    );
    expect(response.status).toBe(400);
  });

  it('乖離を示しても打刻や計算は変わらない', async () => {
    const instance = app();
    const before = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );

    await sendObservations(instance, fixture, 'no-mutation-observations', [
      { observationType: 'sign_in', occurredAt: '2026-03-31T23:00:00.000Z' },
      { observationType: 'sign_out', occurredAt: '2026-04-01T11:00:00.000Z' },
    ]);
    await report(instance, fixture.employeeCookie);

    const after = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});
