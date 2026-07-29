import type { RecordAttendanceEventResponse, WorkDay } from '@staffweave/contracts';
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

function app(now?: () => Date) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    ...(now === undefined ? {} : { now }),
  });
}

async function punch(
  instance: ReturnType<typeof app>,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return instance.request('/api/attendance/events', authorized(cookie, { method: 'POST', body }));
}

describe('最小打刻', () => {
  let workspaceId: string;
  let cookie: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '勤怠 花子',
      email: 'hanako@example.com',
    });
    cookie = await loginAndGetCookie(app(), { email: 'hanako@example.com' });
  });

  it('出勤を打刻すると勤務中になる', async () => {
    const instance = app();
    const response = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'request-clock-in-1',
    });
    const body = (await response.json()) as RecordAttendanceEventResponse;

    expect(response.status).toBe(201);
    expect(body.duplicate).toBe(false);
    expect(body.event.eventType).toBe('clock_in');
    expect(body.event.source).toBe('web');
    expect(body.day.state).toBe('working');
    expect(body.day.firstClockInAt).toBe(body.event.occurredAt);
  });

  it('出勤して退勤すると退勤済みになる', async () => {
    const instance = app();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'request-in-1' });
    const response = await punch(instance, cookie, {
      eventType: 'clock_out',
      requestId: 'request-out-1',
    });
    const body = (await response.json()) as RecordAttendanceEventResponse;

    expect(response.status).toBe(201);
    expect(body.day.state).toBe('finished');
    expect(body.day.events).toHaveLength(2);
  });

  it('当日の状態を取得できる', async () => {
    const instance = app();
    const before = (await (
      await instance.request('/api/attendance/today', authorized(cookie))
    ).json()) as WorkDay;
    expect(before.state).toBe('not_started');
    expect(before.events).toEqual([]);

    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'request-in-2' });

    const after = (await (
      await instance.request('/api/attendance/today', authorized(cookie))
    ).json()) as WorkDay;
    expect(after.state).toBe('working');
    expect(after.events).toHaveLength(1);
  });

  it('打刻イベントは書き換えられない', async () => {
    const instance = app();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'request-in-3' });

    await expect(
      testDatabase().query("UPDATE attendance_events SET event_type = 'clock_out'"),
    ).rejects.toThrow(/追記のみ/);
    await expect(testDatabase().query('DELETE FROM attendance_events')).rejects.toThrow(/追記のみ/);
  });

  it('打刻ごとに監査記録が残る', async () => {
    const instance = app();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'request-in-4' });
    await punch(instance, cookie, { eventType: 'clock_out', requestId: 'request-out-4' });

    const rows = await testDatabase().query<{ action: string; summary: string }>(
      'SELECT action, summary FROM audit_logs WHERE workspace_id = $1 ORDER BY occurred_at',
      [workspaceId],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.action).toBe('attendance_event.recorded');
    expect(rows[0]?.summary).toContain('出勤');
    expect(rows[1]?.summary).toContain('退勤');
  });

  it('監査記録も書き換えられない', async () => {
    const instance = app();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'request-in-5' });

    await expect(testDatabase().query('DELETE FROM audit_logs')).rejects.toThrow(/追記のみ/);
  });
});

describe('二重送信の防止', () => {
  let cookie: string;

  beforeEach(async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '勤怠 花子',
      email: 'hanako@example.com',
    });
    cookie = await loginAndGetCookie(app(), { email: 'hanako@example.com' });
  });

  it('同じ冪等キーの再送は 1 件しか記録しない', async () => {
    const instance = app();
    const body = { eventType: 'clock_in', requestId: 'same-request-id' };

    const first = await punch(instance, cookie, body);
    const second = await punch(instance, cookie, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);

    const firstBody = (await first.json()) as RecordAttendanceEventResponse;
    const secondBody = (await second.json()) as RecordAttendanceEventResponse;

    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.event.id).toBe(firstBody.event.id);
    expect(secondBody.day.events).toHaveLength(1);
  });

  it('同時に届いた同じ冪等キーでも 1 件しか記録しない', async () => {
    const instance = app();
    const body = { eventType: 'clock_in', requestId: 'concurrent-request-id' };

    const responses = await Promise.all([
      punch(instance, cookie, body),
      punch(instance, cookie, body),
      punch(instance, cookie, body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('異なる冪等キーの同時出勤は 1 件だけ受け付ける', async () => {
    const instance = app();

    const responses = await Promise.all([
      punch(instance, cookie, { eventType: 'clock_in', requestId: 'race-request-a' }),
      punch(instance, cookie, { eventType: 'clock_in', requestId: 'race-request-b' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(1);
  });
});

describe('受け付けられない打刻', () => {
  let cookie: string;

  beforeEach(async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '勤怠 花子',
      email: 'hanako@example.com',
    });
    cookie = await loginAndGetCookie(app(), { email: 'hanako@example.com' });
  });

  it('出勤前の退勤は 409 を返す', async () => {
    const response = await punch(app(), cookie, {
      eventType: 'clock_out',
      requestId: 'invalid-clock-out',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '勤務中ではない',
    );
  });

  it('連続した出勤は 409 を返す', async () => {
    const instance = app();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'first-clock-in' });
    const response = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'second-clock-in',
    });
    expect(response.status).toBe(409);
  });

  it('退勤後の再出勤は 409 を返す', async () => {
    const instance = app();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'day-clock-in' });
    await punch(instance, cookie, { eventType: 'clock_out', requestId: 'day-clock-out' });
    const response = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'day-in-again',
    });
    expect(response.status).toBe(409);
  });

  it('未来の時刻は打刻できない', async () => {
    const response = await punch(app(), cookie, {
      eventType: 'clock_in',
      requestId: 'future-request',
      occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(response.status).toBe(400);
  });

  it('24 時間より前の時刻は打刻できない', async () => {
    const response = await punch(app(), cookie, {
      eventType: 'clock_in',
      requestId: 'ancient-request',
      occurredAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(response.status).toBe(400);
  });

  it('短すぎる冪等キーは契約違反として拒否する', async () => {
    const response = await punch(app(), cookie, { eventType: 'clock_in', requestId: 'short' });
    expect(response.status).toBe(400);
  });

  it('未知の打刻種別は契約違反として拒否する', async () => {
    const response = await punch(app(), cookie, {
      eventType: 'lunch_start',
      requestId: 'unknown-type-request',
    });
    expect(response.status).toBe(400);
  });
});

describe('従業員が紐づかない利用者', () => {
  beforeEach(async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
  });

  it('打刻できない', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

    const response = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'no-employee-request',
    });
    expect(response.status).toBe(403);
    expect((await instance.request('/api/attendance/today', authorized(cookie))).status).toBe(403);
  });
});

describe('業務日とワークスペース境界', () => {
  it('拠点のタイムゾーンで業務日が決まる', async () => {
    const workspaceId = await createWorkspace(testDatabase(), {
      slug: 'default',
      timeZone: 'UTC',
    });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    const siteRows = await testDatabase().query<{ id: string }>(
      `INSERT INTO sites (workspace_id, organization_id, code, name, time_zone)
       VALUES ($1, $2, 'TOKYO', '東京', 'Asia/Tokyo') RETURNING id`,
      [workspaceId, organizationId],
    );
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '深夜 太郎',
      email: 'yakin@example.com',
      primarySiteId: siteRows[0]?.id ?? null,
    });

    // UTC 2026-04-01T20:00 は Asia/Tokyo では 2026-04-02 05:00。
    const instance = app(() => new Date('2026-04-01T20:00:00.000Z'));
    const cookie = await loginAndGetCookie(instance, { email: 'yakin@example.com' });
    const response = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'timezone-request',
      occurredAt: '2026-04-01T20:00:00.000Z',
    });
    const body = (await response.json()) as RecordAttendanceEventResponse;

    expect(body.event.businessDate).toBe('2026-04-02');
  });

  it('他ワークスペースの打刻は見えない', async () => {
    const first = await createWorkspace(testDatabase(), { slug: 'default' });
    const second = await createWorkspace(testDatabase(), { slug: 'other' });

    const firstOrganization = await createOrganization(testDatabase(), first, { code: 'HQ' });
    const secondOrganization = await createOrganization(testDatabase(), second, { code: 'HQ' });

    await createEmployeeWithAccount(testDatabase(), first, {
      organizationId: firstOrganization,
      employeeNumber: 'E001',
      displayName: '第一 太郎',
      email: 'person@example.com',
    });
    await createEmployeeWithAccount(testDatabase(), second, {
      organizationId: secondOrganization,
      employeeNumber: 'E001',
      displayName: '第二 太郎',
      email: 'person@example.com',
    });

    const instance = app();
    const firstCookie = await loginAndGetCookie(instance, { email: 'person@example.com' });
    const secondCookie = await loginAndGetCookie(instance, {
      email: 'person@example.com',
      workspaceSlug: 'other',
    });

    await punch(instance, firstCookie, { eventType: 'clock_in', requestId: 'first-workspace-in' });

    const secondDay = (await (
      await instance.request('/api/attendance/today', authorized(secondCookie))
    ).json()) as WorkDay;

    expect(secondDay.state).toBe('not_started');
    expect(secondDay.events).toEqual([]);
  });
});
