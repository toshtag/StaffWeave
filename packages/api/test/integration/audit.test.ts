import { generateKeyPair, signPayload } from '@staffweave/agent';
import type {
  AnomalyList,
  AuditLogList,
  DailyRequestRecord,
  EnrollDeviceResponse,
  RegisterDeviceResponse,
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
  approverCookie: string;
  employeeCookie: string;
  employeeId: string;
}

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const approverUserId = await createUser(db, workspaceId, {
    email: 'approver@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: approverUserId, organizationId });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  return {
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    approverCookie: await loginAndGetCookie(instance, { email: 'approver@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    employeeId: employee.employeeId,
  };
}

async function anomalies(instance: App, cookie: string, format?: string): Promise<Response> {
  const query = `from=2026-04-01&to=2026-04-30${format === undefined ? '' : `&format=${format}`}`;
  return instance.request(`/api/audit/anomalies?${query}`, authorized(cookie));
}

async function punch(
  instance: App,
  cookie: string,
  eventType: string,
  requestId: string,
  occurredAt: string,
): Promise<Response> {
  return instance.request(
    '/api/attendance/events',
    authorized(cookie, { method: 'POST', body: { eventType, requestId, occurredAt } }),
  );
}

describe('異常検出', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('通常の勤務では何も出ない', async () => {
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'normal-in', CLOCK_IN_AT);
    await punch(instance, fixture.employeeCookie, 'clock_out', 'normal-out', CLOCK_OUT_AT);

    const response = await anomalies(instance, fixture.adminCookie);
    expect(((await response.json()) as AnomalyList).anomalies).toEqual([]);
  });

  it('確定した後の打刻を根拠つきで示す', async () => {
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'final-in', CLOCK_IN_AT);
    await punch(instance, fixture.employeeCookie, 'clock_out', 'final-out', CLOCK_OUT_AT);

    const submitted = await instance.request(
      '/api/attendance/requests',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { businessDate: BUSINESS_DATE },
      }),
    );
    const request = (await submitted.json()) as DailyRequestRecord;
    await instance.request(
      `/api/attendance/requests/${request.id}/approve`,
      authorized(fixture.approverCookie, { method: 'POST', body: {} }),
    );

    // 承認後に打刻を書き込む（API 経由では拒否されるため、直接記録された場合を想定）。
    await testDatabase().query(
      `INSERT INTO attendance_events
         (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
       SELECT workspace_id, id, 'break_start', $2::timestamptz, $3::date, 'web', 'sneaked-event'
         FROM employees WHERE id = $1`,
      [fixture.employeeId, '2026-04-01T05:00:00.000Z', BUSINESS_DATE],
    );

    const response = await anomalies(instance, fixture.adminCookie);
    const found = ((await response.json()) as AnomalyList).anomalies.find(
      (anomaly) => anomaly.kind === 'post_finalization_change',
    );

    expect(found).toBeDefined();
    expect(found?.severity).toBe('warning');
    expect(found?.businessDate).toBe(BUSINESS_DATE);
    expect(found?.evidence.decidedAt).toBeDefined();
  });

  it('修正が多すぎる日を示す', async () => {
    const instance = app();
    const created = await punch(
      instance,
      fixture.employeeCookie,
      'clock_in',
      'many-corrections-in',
      CLOCK_IN_AT,
    );
    const eventId = ((await created.json()) as { event: { id: string } }).event.id;

    for (const index of [1, 2, 3, 4]) {
      await instance.request(
        '/api/attendance/corrections',
        authorized(fixture.employeeCookie, {
          method: 'POST',
          body: {
            action: 'adjust',
            targetEventId: eventId,
            occurredAt: `2026-04-01T0${index}:00:00.000Z`,
            reason: `${index} 回目の修正`,
            requestId: `correction-request-${index}`,
          },
        }),
      );
    }

    const response = await anomalies(instance, fixture.adminCookie);
    const found = ((await response.json()) as AnomalyList).anomalies.find(
      (anomaly) => anomaly.kind === 'excessive_corrections',
    );

    expect(found?.evidence.corrections).toBe(4);
    expect(found?.summary).toContain('4 件');
  });

  it('短い間隔で並んだ同じ種別の打刻を示す', async () => {
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'duplicate-in', CLOCK_IN_AT);

    // 修正で 1 分後に同じ種別の打刻を足す。
    await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'add',
          eventType: 'clock_in',
          occurredAt: '2026-04-01T00:01:00.000Z',
          businessDate: BUSINESS_DATE,
          reason: '打刻漏れの補完',
          requestId: 'duplicate-correction',
        },
      }),
    );

    const response = await anomalies(instance, fixture.adminCookie);
    const found = ((await response.json()) as AnomalyList).anomalies.find(
      (anomaly) => anomaly.kind === 'duplicate_event',
    );

    expect(found?.evidence.minutesApart).toBe(1);
  });

  it('CSV として出力できる', async () => {
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'csv-clock-in', CLOCK_IN_AT);
    await instance.request(
      '/api/attendance/corrections',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          action: 'add',
          eventType: 'clock_in',
          occurredAt: '2026-04-01T00:01:00.000Z',
          businessDate: BUSINESS_DATE,
          reason: '打刻漏れの補完',
          requestId: 'csv-correction',
        },
      }),
    );

    const response = await anomalies(instance, fixture.adminCookie, 'csv');
    const text = await response.text();

    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(text.split('\n')[0]).toBe(
      '"kind","severity","summary","employee_id","business_date","device_id","detected_at","evidence"',
    );
    expect(text).toContain('duplicate_event');
  });

  it('期間の指定が不正なら 400 を返す', async () => {
    const response = await app().request(
      '/api/audit/anomalies?from=2026-04-30&to=2026-04-01',
      authorized(fixture.adminCookie),
    );
    expect(response.status).toBe(400);
  });

  it('従業員ロールは異常を確認できない', async () => {
    const response = await anomalies(app(), fixture.employeeCookie);
    expect(response.status).toBe(403);
  });
});

describe('端末に関する異常', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('端末時計のずれと連番の欠落を示す', async () => {
    const instance = app(CLOCK_IN_AT);

    const registered = (await (
      await instance.request(
        '/api/devices',
        authorized(fixture.adminCookie, { method: 'POST', body: { name: '入口の端末' } }),
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

    async function send(sequence: number, requestId: string, deviceTime: string) {
      const payload = {
        sequence,
        requestId,
        employeeNumber: 'E001',
        eventType: 'clock_in' as const,
        occurredAt: CLOCK_IN_AT,
        deviceTime,
      };
      return instance.request('/api/device-agent/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-staffweave-device': enrolled.deviceId,
          'x-staffweave-signature': signPayload(keyPair.privateKeyPem, {
            deviceId: enrolled.deviceId,
            ...payload,
          }),
        },
        body: JSON.stringify(payload),
      });
    }

    // 連番 5 から始め、端末の時計が 10 分進んでいる。
    await send(5, 'device-skew-request', '2026-04-01T00:10:00.000Z');

    const response = await anomalies(instance, fixture.adminCookie);
    const found = ((await response.json()) as AnomalyList).anomalies;

    const skew = found.find((anomaly) => anomaly.kind === 'device_clock_skew');
    const gap = found.find((anomaly) => anomaly.kind === 'sequence_gap');

    expect(skew?.evidence.clockSkewSeconds).toBe(600);
    expect(skew?.deviceId).toBe(enrolled.deviceId);
    expect(gap?.evidence.missing).toBe(4);
  });
});

describe('監査記録', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('操作の記録を一覧できる', async () => {
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'audit-log-in', CLOCK_IN_AT);

    const response = await instance.request('/api/audit/logs', authorized(fixture.adminCookie));
    const body = (await response.json()) as AuditLogList;

    expect(response.status).toBe(200);
    expect(body.logs.some((log) => log.action === 'attendance_event.recorded')).toBe(true);
    expect(body.logs[0]?.summary).toBeTruthy();
  });

  it('従業員ロールは監査記録を見られない', async () => {
    const response = await app().request('/api/audit/logs', authorized(fixture.employeeCookie));
    expect(response.status).toBe(403);
  });

  // 記録には従業員に紐づかない操作が混ざり、要約には氏名がそのまま入る。
  // 閲覧範囲で機械的に絞れないため、組織管理者にも見せない。
  it('組織管理者は閲覧範囲を持っていても監査記録を見られない', async () => {
    const instance = app();
    await punch(instance, fixture.employeeCookie, 'clock_in', 'audit-scope-in', CLOCK_IN_AT);

    const response = await instance.request('/api/audit/logs', authorized(fixture.approverCookie));

    expect(response.status).toBe(403);
  });
});
