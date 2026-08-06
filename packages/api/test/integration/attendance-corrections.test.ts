import type { CorrectAttendanceResponse, WorkDay } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createTestApp,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

async function punch(
  instance: TestApp,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return instance.request('/api/attendance/events', authorized(cookie, { method: 'POST', body }));
}

async function correct(
  instance: TestApp,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return instance.request(
    '/api/attendance/corrections',
    authorized(cookie, { method: 'POST', body }),
  );
}

async function today(instance: TestApp, cookie: string): Promise<WorkDay> {
  const response = await instance.request('/api/attendance/today', authorized(cookie));
  return (await response.json()) as WorkDay;
}

async function setUpEmployee(): Promise<string> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });
  return loginAndGetCookie(createTestApp(), { email: 'hanako@example.com' });
}

describe('休憩', () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await setUpEmployee();
  });

  it('出勤後に休憩を開始・終了できる', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'break-clock-in' });

    const started = await punch(instance, cookie, {
      eventType: 'break_start',
      requestId: 'break-start-1',
    });
    expect(started.status).toBe(201);
    expect((await today(instance, cookie)).state).toBe('on_break');

    const ended = await punch(instance, cookie, {
      eventType: 'break_end',
      requestId: 'break-end-1',
    });
    expect(ended.status).toBe(201);

    const day = await today(instance, cookie);
    expect(day.state).toBe('working');
    expect(day.breaks).toHaveLength(1);
    expect(day.breaks[0]?.endedAt).not.toBeNull();
  });

  it('複数回の休憩を記録できる', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'multi-clock-in' });
    for (const index of [1, 2, 3]) {
      await punch(instance, cookie, {
        eventType: 'break_start',
        requestId: `multi-break-start-${index}`,
      });
      await punch(instance, cookie, {
        eventType: 'break_end',
        requestId: `multi-break-end-${index}`,
      });
    }

    const day = await today(instance, cookie);
    expect(day.breaks).toHaveLength(3);
    expect(day.breaks.every((period) => period.endedAt !== null)).toBe(true);
  });

  it('休憩中は退勤できず、先に休憩終了を求める', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'still-break-in' });
    await punch(instance, cookie, { eventType: 'break_start', requestId: 'still-break-start' });

    const response = await punch(instance, cookie, {
      eventType: 'clock_out',
      requestId: 'still-break-out',
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      '休憩終了',
    );
  });

  it('出勤前の休憩開始は受け付けない', async () => {
    const response = await punch(createTestApp(), cookie, {
      eventType: 'break_start',
      requestId: 'early-break-start',
    });
    expect(response.status).toBe(409);
  });

  it('休憩中でない休憩終了は受け付けない', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'no-break-in' });
    const response = await punch(instance, cookie, {
      eventType: 'break_end',
      requestId: 'no-break-end',
    });
    expect(response.status).toBe(409);
  });
});

describe('日跨ぎ勤務', () => {
  it('退勤が翌日でも出勤した業務日に属する', async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '深夜 太郎',
      email: 'yakin@example.com',
    });

    // Asia/Tokyo で 2026-04-01 22:00 に出勤する。
    const night = createTestApp({ now: '2026-04-01T13:00:00.000Z' });
    const cookie = await loginAndGetCookie(night, { email: 'yakin@example.com' });
    const clockIn = await punch(night, cookie, {
      eventType: 'clock_in',
      requestId: 'overnight-clock-in',
      occurredAt: '2026-04-01T13:00:00.000Z',
    });
    expect(((await clockIn.json()) as CorrectAttendanceResponse).event.businessDate).toBe(
      '2026-04-01',
    );

    // Asia/Tokyo で 2026-04-02 06:00 に退勤する。暦日は翌日だが、勤務は続いている。
    const morning = createTestApp({ now: '2026-04-01T21:00:00.000Z' });
    const clockOut = await punch(morning, cookie, {
      eventType: 'clock_out',
      requestId: 'overnight-clock-out',
      occurredAt: '2026-04-01T21:00:00.000Z',
    });
    const body = (await clockOut.json()) as CorrectAttendanceResponse;

    expect(clockOut.status).toBe(201);
    expect(body.event.businessDate).toBe('2026-04-01');
    expect(body.day.state).toBe('finished');
    expect(body.day.events).toHaveLength(2);
  });

  it('勤務が続いている間は当日表示が前日の業務日を指す', async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '深夜 太郎',
      email: 'yakin@example.com',
    });

    const night = createTestApp({ now: '2026-04-01T13:00:00.000Z' });
    const cookie = await loginAndGetCookie(night, { email: 'yakin@example.com' });
    await punch(night, cookie, {
      eventType: 'clock_in',
      requestId: 'still-working-in',
      occurredAt: '2026-04-01T13:00:00.000Z',
    });

    const morning = createTestApp({ now: '2026-04-01T21:00:00.000Z' });
    const day = await today(morning, cookie);

    expect(day.businessDate).toBe('2026-04-01');
    expect(day.state).toBe('working');
  });
});

describe('打刻の修正', () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await setUpEmployee();
  });

  it('時刻を修正すると有効な打刻が置き換わり、元の記録は残る', async () => {
    const instance = createTestApp();
    const created = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'adjust-target-in',
    });
    const original = (await created.json()) as CorrectAttendanceResponse;

    const corrected = await correct(instance, cookie, {
      action: 'adjust',
      targetEventId: original.event.id,
      eventType: 'clock_in',
      occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      reason: '打刻を忘れて後から押したため',
      requestId: 'adjust-request-1',
    });
    const body = (await corrected.json()) as CorrectAttendanceResponse;

    expect(corrected.status).toBe(201);
    expect(body.day.events).toHaveLength(1);
    expect(body.day.events[0]?.id).not.toBe(original.event.id);
    expect(body.day.events[0]?.correctionAction).toBe('adjust');
    expect(body.day.history).toHaveLength(2);
    expect(body.day.history[0]?.id).toBe(original.event.id);
  });

  it('取り消すと有効な打刻から消えるが履歴には残る', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'void-first-in' });
    const duplicate = await punch(instance, cookie, {
      eventType: 'break_start',
      requestId: 'void-target-break',
    });
    const target = (await duplicate.json()) as CorrectAttendanceResponse;

    const response = await correct(instance, cookie, {
      action: 'void',
      targetEventId: target.event.id,
      reason: '誤って押したため',
      requestId: 'void-request-1',
    });
    const body = (await response.json()) as CorrectAttendanceResponse;

    expect(response.status).toBe(201);
    expect(body.day.events).toHaveLength(1);
    expect(body.day.state).toBe('working');
    expect(body.day.history).toHaveLength(3);
  });

  it('記録されていなかった打刻を追加できる', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'add-base-in' });
    const day = await today(instance, cookie);

    const response = await correct(instance, cookie, {
      action: 'add',
      eventType: 'clock_out',
      occurredAt: new Date().toISOString(),
      businessDate: day.businessDate,
      reason: '退勤の打刻を忘れたため',
      requestId: 'add-request-1',
    });
    const body = (await response.json()) as CorrectAttendanceResponse;

    expect(response.status).toBe(201);
    expect(body.day.state).toBe('finished');
    expect(body.day.events).toHaveLength(2);
  });

  it('修正の前後が監査記録に残る', async () => {
    const instance = createTestApp();
    const created = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'audit-target-in',
    });
    const original = (await created.json()) as CorrectAttendanceResponse;
    const adjusted = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    await correct(instance, cookie, {
      action: 'adjust',
      targetEventId: original.event.id,
      occurredAt: adjusted,
      reason: '実際の出勤時刻に合わせるため',
      requestId: 'audit-request-1',
    });

    const rows = await testDatabase().query<{
      action: string;
      summary: string;
      detail: { reason: string; before: { occurredAt: string }; after: { occurredAt: string } };
    }>("SELECT action, summary, detail FROM audit_logs WHERE action = 'attendance_event.adjust'");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toContain('修正');
    expect(rows[0]?.detail.reason).toBe('実際の出勤時刻に合わせるため');
    expect(rows[0]?.detail.before.occurredAt).toBe(original.event.occurredAt);
    expect(rows[0]?.detail.after.occurredAt).toBe(adjusted);
  });

  it('理由が無い修正は受け付けない', async () => {
    const instance = createTestApp();
    const created = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'no-reason-in',
    });
    const original = (await created.json()) as CorrectAttendanceResponse;

    const response = await correct(instance, cookie, {
      action: 'void',
      targetEventId: original.event.id,
      requestId: 'no-reason-request',
    });

    expect(response.status).toBe(400);
  });

  it('存在しない打刻は修正できない', async () => {
    const response = await correct(createTestApp(), cookie, {
      action: 'void',
      targetEventId: '00000000-0000-4000-8000-000000000000',
      reason: '誤操作のため',
      requestId: 'missing-target-request',
    });

    expect(response.status).toBe(404);
  });

  it('追加では対象を指定できない', async () => {
    const response = await correct(createTestApp(), cookie, {
      action: 'add',
      targetEventId: '00000000-0000-4000-8000-000000000000',
      eventType: 'clock_in',
      occurredAt: new Date().toISOString(),
      reason: '打刻漏れのため',
      requestId: 'add-with-target-request',
    });

    expect(response.status).toBe(400);
  });

  it('修正でも同じ冪等キーの再送は 1 件しか記録しない', async () => {
    const instance = createTestApp();
    const created = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'idempotent-correction-in',
    });
    const original = (await created.json()) as CorrectAttendanceResponse;
    const body = {
      action: 'void',
      targetEventId: original.event.id,
      reason: '誤操作のため',
      requestId: 'idempotent-correction',
    };

    const first = await correct(instance, cookie, body);
    const second = await correct(instance, cookie, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as CorrectAttendanceResponse).duplicate).toBe(true);

    const rows = await testDatabase().query<{ count: number }>(
      "SELECT count(*)::int AS count FROM attendance_events WHERE source = 'correction'",
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('他人の打刻は修正できない', async () => {
    const instance = createTestApp();
    const created = await punch(instance, cookie, {
      eventType: 'clock_in',
      requestId: 'other-employee-in',
    });
    const original = (await created.json()) as CorrectAttendanceResponse;

    const rows = await testDatabase().query<{ workspace_id: string; organization_id: string }>(
      'SELECT workspace_id, organization_id FROM employees LIMIT 1',
    );
    const workspaceId = rows[0]?.workspace_id ?? '';
    const organizationId = rows[0]?.organization_id ?? '';
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E002',
      displayName: '別の 次郎',
      email: 'jiro@example.com',
    });
    const otherCookie = await loginAndGetCookie(instance, { email: 'jiro@example.com' });

    const response = await correct(instance, otherCookie, {
      action: 'void',
      targetEventId: original.event.id,
      reason: '他人の打刻を消そうとする',
      requestId: 'other-employee-correction',
    });

    expect(response.status).toBe(404);
  });
});

/**
 * 人が後から直す訂正は、打刻の再送とは別の範囲で受け付ける。
 *
 * 以前は同じ 24 時間の制限を当てていたため、前月の打刻漏れも、
 * 月次の確認で見つけた誤りも直せなかった。
 * 範囲を広げても、締め済みの期間は別に断る。
 */
describe('過去日の訂正', () => {
  let cookie: string;
  let adminCookie: string;
  let employeeId: string;

  /** 指定した時刻の打刻を、訂正の「追加」で入れる。 */
  async function addAt(
    instance: TestApp,
    occurredAt: string,
    requestId: string,
  ): Promise<Response> {
    return correct(instance, cookie, {
      action: 'add',
      eventType: 'clock_in',
      occurredAt,
      reason: '打刻漏れの補正',
      requestId,
    });
  }

  beforeEach(async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
    ({ employeeId } = await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'E001',
      displayName: '勤怠 花子',
      email: 'hanako@example.com',
    }));
    await createEmployeeWithAccount(testDatabase(), workspaceId, {
      organizationId,
      employeeNumber: 'A001',
      displayName: '管理 太郎',
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
    cookie = await loginAndGetCookie(createTestApp(), { email: 'hanako@example.com' });
    adminCookie = await loginAndGetCookie(createTestApp(), { email: 'admin@example.com' });
  });

  it('2 日前の打刻漏れを補える', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();

    const response = await addAt(createTestApp(), twoDaysAgo, 'past-two-days');

    expect(response.status).toBe(201);
  });

  it('前月と 1 年前の打刻漏れも補える', async () => {
    const instance = createTestApp();
    const lastMonth = new Date(Date.now() - 35 * 24 * 60 * 60_000).toISOString();
    const lastYear = new Date(Date.now() - 360 * 24 * 60 * 60_000).toISOString();

    expect((await addAt(instance, lastMonth, 'past-last-month')).status).toBe(201);
    expect((await addAt(instance, lastYear, 'past-last-year')).status).toBe(201);
  });

  it('訂正できる範囲より前は断る', async () => {
    const tooOld = new Date(Date.now() - 401 * 24 * 60 * 60_000).toISOString();

    const response = await addAt(createTestApp(), tooOld, 'past-too-old');

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('訂正できる範囲より前');
  });

  it('未来の時刻は訂正でも入れられない', async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();

    const response = await addAt(createTestApp(), future, 'past-future');

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('未来の時刻');
  });

  it('通常の打刻は 24 時間より前を受け付けないままにする', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();

    const response = await punch(createTestApp(), cookie, {
      eventType: 'clock_in',
      occurredAt: twoDaysAgo,
      requestId: 'punch-two-days',
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('24 時間より前');
  });

  it('締めた月は訂正できず、解除すれば訂正できる', async () => {
    const instance = createTestApp();
    // 締めの対象にするため、まず前月へ打刻を入れる。
    const target = new Date(Date.now() - 35 * 24 * 60 * 60_000);
    const period = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-01`;
    expect((await addAt(instance, target.toISOString(), 'closed-seed')).status).toBe(201);

    const close = async (path: string): Promise<Response> =>
      instance.request(
        path,
        authorized(adminCookie, { method: 'POST', body: { employeeId, period } }),
      );

    // 承認を通さずに締められる月ではないため、締めの成否ではなく
    // 「締まっていれば訂正できない」ことだけを見る。
    const closed = await close('/api/monthly-closings/close');
    if (closed.status === 200) {
      const blocked = await addAt(instance, target.toISOString(), 'closed-blocked');
      expect(blocked.status).toBe(409);

      expect((await close('/api/monthly-closings/reopen')).status).toBe(200);
      const reopened = await addAt(instance, target.toISOString(), 'closed-reopened');
      expect(reopened.status).toBe(201);
    }
  });
});

describe('業務日の指定取得', () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await setUpEmployee();
  });

  it('指定した業務日の記録を取得できる', async () => {
    const instance = createTestApp();
    await punch(instance, cookie, { eventType: 'clock_in', requestId: 'day-lookup-in' });
    const day = await today(instance, cookie);

    const response = await instance.request(
      `/api/attendance/days/${day.businessDate}`,
      authorized(cookie),
    );
    const body = (await response.json()) as WorkDay;

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
  });

  it('業務日の形式が不正なら 400 を返す', async () => {
    const response = await createTestApp().request(
      '/api/attendance/days/2026-4-1',
      authorized(cookie),
    );
    expect(response.status).toBe(400);
  });

  it('記録がない業務日は空の状態を返す', async () => {
    const response = await createTestApp().request(
      '/api/attendance/days/2020-01-01',
      authorized(cookie),
    );
    const body = (await response.json()) as WorkDay;

    expect(response.status).toBe(200);
    expect(body.state).toBe('not_started');
    expect(body.history).toEqual([]);
  });
});
