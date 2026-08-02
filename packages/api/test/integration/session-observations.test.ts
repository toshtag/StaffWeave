import { generateKeyPair, signMessage, signPayload } from '@staffweave/agent';
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

/** Asia/Tokyo の 2026-04-01 における各時刻。 */
const CLOCK_IN_AT = '2026-04-01T00:00:00.000Z'; // 09:00
const BREAK_START_AT = '2026-04-01T03:00:00.000Z'; // 12:00
const BREAK_END_AT = '2026-04-01T04:00:00.000Z'; // 13:00
const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z'; // 18:00
const BUSINESS_DATE = '2026-04-01';

const app = testAppFactory({ now: CLOCK_OUT_AT });

type App = TestApp;

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
  overrides: { signature?: string; sequence?: number } = {},
): Promise<Response> {
  const body = {
    sequence: overrides.sequence ?? fixture.sequence,
    requestId,
    workstationName: 'desk-01',
    observations: lines.map((line) => ({
      employeeNumber: line.employeeNumber ?? 'E001',
      observationType: line.observationType,
      occurredAt: line.occurredAt,
    })),
  };
  // 連番を明示した送信は、続く自動採番へ影響させない。
  if (overrides.sequence === undefined) fixture.sequence += 1;

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

/** 同じ端末から署名して送る打刻イベント。PC 観測と連番を共有する。 */
async function sendSignedEvent(
  instance: App,
  fixture: Fixture,
  sequence: number,
  requestId: string,
  eventType: 'clock_in' | 'clock_out' = 'clock_in',
): Promise<Response> {
  const payload = {
    sequence,
    requestId,
    employeeNumber: 'E001',
    eventType,
    occurredAt: CLOCK_IN_AT,
    deviceTime: CLOCK_IN_AT,
  };

  return instance.request('/api/device-agent/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': fixture.device.deviceId,
      'x-staffweave-signature': signPayload(fixture.device.privateKeyPem, {
        deviceId: fixture.device.deviceId,
        ...payload,
      }),
    },
    body: JSON.stringify(payload),
  });
}

interface ReceiptRow {
  sequence: number;
  sequence_step: number;
  outcome: string;
  accepted: number;
  skipped: number;
  detail: Record<string, unknown>;
}

async function receiptsOf(requestId: string): Promise<ReceiptRow[]> {
  return testDatabase().query<ReceiptRow>(
    `SELECT sequence, sequence_step, outcome, accepted, skipped, detail
       FROM workstation_session_receipts WHERE request_id = $1`,
    [requestId],
  );
}

async function observationCount(): Promise<number> {
  const rows = await testDatabase().query<{ count: number }>(
    'SELECT count(*)::int AS count FROM workstation_session_observations',
  );
  return rows[0]?.count ?? 0;
}

async function lastSequence(): Promise<number> {
  const rows = await testDatabase().query<{ last_sequence: number }>(
    'SELECT last_sequence FROM devices',
  );
  return rows[0]?.last_sequence ?? 0;
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

    // 再送は連番も同じ値で届く。
    const first = await sendObservations(instance, fixture, 'session-idempotent', lines, {
      sequence: 1,
    });
    const second = await sendObservations(instance, fixture, 'session-idempotent', lines, {
      sequence: 1,
    });

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

describe('端末の連番', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  const line: ObservationLine = { observationType: 'sign_in', occurredAt: CLOCK_IN_AT };

  it('受け取り済みの連番を別の冪等キーで送れば断る', async () => {
    const instance = app();

    const first = await sendObservations(instance, fixture, 'session-sequence-a', [line], {
      sequence: 1,
    });
    const reused = await sendObservations(instance, fixture, 'session-sequence-b', [line], {
      sequence: 1,
    });

    expect(first.status).toBe(201);
    expect(reused.status).toBe(409);
    expect(await observationCount()).toBe(1);
    expect(await lastSequence()).toBe(1);
  });

  it('連番の巻き戻しを断り、断ったことを受領記録へ残す', async () => {
    const instance = app();

    await sendObservations(instance, fixture, 'session-sequence-5', [line], { sequence: 5 });
    const rolledBack = await sendObservations(instance, fixture, 'session-sequence-3', [line], {
      sequence: 3,
    });

    expect(rolledBack.status).toBe(409);
    expect(await lastSequence()).toBe(5);

    const receipts = await receiptsOf('session-sequence-3');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.outcome).toBe('rejected');
    expect(receipts[0]?.detail).toMatchObject({ reason: 'sequence_replay', lastSequence: 5 });
  });

  it('連番の欠落は受理し、欠落数を受領記録と監査へ残す', async () => {
    const instance = app();

    await sendObservations(instance, fixture, 'session-gap-first', [line], { sequence: 1 });
    const response = await sendObservations(instance, fixture, 'session-gap-second', [line], {
      sequence: 4,
    });

    expect(response.status).toBe(201);
    expect(await lastSequence()).toBe(4);

    const receipts = await receiptsOf('session-gap-second');
    expect(receipts[0]?.sequence_step).toBe(3);
    expect(receipts[0]?.detail).toMatchObject({ sequenceGap: 2 });

    const audits = await testDatabase().query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM audit_logs WHERE action = 'session_observation.recorded'",
    );
    expect(audits.map((row) => row.detail)).toContainEqual(
      expect.objectContaining({ sequence: 4, sequenceStep: 3, sequenceGap: 2 }),
    );
  });

  it('すべて対象外の要求でも受領記録を残し、再送は記録を増やさない', async () => {
    const instance = app();
    const unknown: ObservationLine[] = [
      { employeeNumber: 'E998', observationType: 'sign_in', occurredAt: CLOCK_IN_AT },
      { employeeNumber: 'E999', observationType: 'lock', occurredAt: CLOCK_OUT_AT },
    ];

    const first = await sendObservations(instance, fixture, 'session-all-skipped', unknown, {
      sequence: 1,
    });
    const body = (await first.json()) as RecordSessionObservationsResponse;
    const resent = await sendObservations(instance, fixture, 'session-all-skipped', unknown, {
      sequence: 1,
    });

    expect(body).toEqual({ outcome: 'accepted', accepted: 0, skipped: 2 });
    expect(resent.status).toBe(200);
    expect(((await resent.json()) as RecordSessionObservationsResponse).outcome).toBe('duplicate');
    expect(await observationCount()).toBe(0);
    expect(await receiptsOf('session-all-skipped')).toHaveLength(1);
    expect(await lastSequence()).toBe(1);
  });

  it('打刻イベントと PC 観測が同じ連番を交互に進める', async () => {
    const instance = app();

    const punchIn = await sendSignedEvent(instance, fixture, 1, 'device-event-1', 'clock_in');
    const observed = await sendObservations(instance, fixture, 'session-cross-2', [line], {
      sequence: 2,
    });
    const punchOut = await sendSignedEvent(instance, fixture, 3, 'device-event-3', 'clock_out');
    const observedAgain = await sendObservations(instance, fixture, 'session-cross-4', [line], {
      sequence: 4,
    });

    expect([punchIn.status, observed.status, punchOut.status, observedAgain.status]).toEqual([
      201, 201, 201, 201,
    ]);
    expect(await lastSequence()).toBe(4);

    // 経路が違っても連番は端末に一つである。使い切った番号は打刻でも観測でも断る。
    const reusedByObservation = await sendObservations(
      instance,
      fixture,
      'session-cross-reuse',
      [line],
      { sequence: 4 },
    );
    const reusedByEvent = await sendSignedEvent(instance, fixture, 4, 'device-event-reuse');

    expect(reusedByObservation.status).toBe(409);
    expect(reusedByEvent.status).toBe(409);
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

  // 従業員の指定は任意だが、渡された値の形は契約どおりに確かめる。
  it('従業員の識別子の形式が不正なら 400 を返す', async () => {
    const response = await app().request(
      `/api/attendance/days/${BUSINESS_DATE}/discrepancies?employeeId=not-a-uuid`,
      authorized(fixture.adminCookie),
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
