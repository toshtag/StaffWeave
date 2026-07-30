import { randomUUID } from 'node:crypto';
import type { CreateWebhookEndpointResponse, DailyRequestRecord } from '@staffweave/contracts';
import type { Database } from '@staffweave/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import { createWebhookOutboxRepository } from '../../src/integration/outbox-repository.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
} from '../support/fixtures.js';
import type { SentWebhook } from '../support/webhook.js';
import { createTestDeliveryProcessor, recordingTransport } from '../support/webhook.js';

/**
 * 承認と Webhook 送信の境界。
 *
 * API は送信待ちを業務データと同じトランザクションで記録するだけで、HTTP 送信は行わない。
 * 送信はワーカーが別に行い、配信は at-least-once とする。
 */

const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z';
const BUSINESS_DATE = '2026-04-01';
const NOW = new Date(CLOCK_OUT_AT);

const sent: SentWebhook[] = [];

function app(db: Database = testDatabase()) {
  return createApp({ db, defaultWorkspaceSlug: 'default', now: () => NOW });
}

/** 業務処理を必ずロールバックさせるデータベース。書き込みの不可分性を確かめるために使う。 */
function alwaysRollingBack(db: Database): Database {
  return {
    query: (text, params) => db.query(text, params),
    transaction: (fn) =>
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Error('検証のために業務処理を失敗させました');
      }),
    ping: () => db.ping(),
    close: () => db.close(),
  };
}

function processor(options: Parameters<typeof createTestDeliveryProcessor>[1]) {
  return createTestDeliveryProcessor(testDatabase(), options);
}

function deliveringProcessor(status = 204) {
  return processor({
    now: NOW,
    transport: recordingTransport(sent, () => new Response(null, { status })),
  });
}

async function countOf(table: string): Promise<number> {
  const rows = await testDatabase().query<{ count: number }>(`SELECT count(*) FROM ${table}`);
  return rows[0]?.count ?? 0;
}

interface Fixture {
  employeeCookie: string;
  approverCookie: string;
  endpoint: CreateWebhookEndpointResponse;
}

async function setUp(): Promise<Fixture> {
  sent.length = 0;
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const approverUserId = await createUser(db, workspaceId, {
    email: 'approver@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: approverUserId, organizationId });
  await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  const adminCookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });
  const registered = await instance.request(
    '/api/webhook-endpoints',
    authorized(adminCookie, {
      method: 'POST',
      body: {
        name: '給与システム',
        url: 'https://example.test/hooks',
        eventTypes: ['attendance_request.approved'],
      },
    }),
  );

  return {
    approverCookie: await loginAndGetCookie(instance, { email: 'approver@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    endpoint: (await registered.json()) as CreateWebhookEndpointResponse,
  };
}

/** 日次申請を提出し、承認する。承認の応答を返す。 */
async function submitAndApprove(fixture: Fixture, db?: Database): Promise<Response> {
  const submitted = await app().request(
    '/api/attendance/requests',
    authorized(fixture.employeeCookie, { method: 'POST', body: { businessDate: BUSINESS_DATE } }),
  );
  const request = (await submitted.json()) as DailyRequestRecord;

  return app(db).request(
    `/api/attendance/requests/${request.id}/approve`,
    authorized(fixture.approverCookie, { method: 'POST', body: {} }),
  );
}

describe('承認と送信待ちの境界', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('承認の応答中に HTTP 送信を行わない', async () => {
    const response = await submitAndApprove(fixture);

    expect(response.status).toBe(200);
    expect(sent).toEqual([]);
    expect(await countOf('webhook_deliveries')).toBe(0);
  });

  it('承認・監査記録・送信待ちが同じトランザクションで確定する', async () => {
    await submitAndApprove(fixture);

    const requests = await testDatabase().query<{ state: string }>(
      'SELECT state FROM daily_attendance_requests',
    );
    const audits = await testDatabase().query<{ action: string }>(
      "SELECT action FROM audit_logs WHERE action = 'attendance_request.approve'",
    );
    const outbox = await testDatabase().query<{
      event_type: string;
      event_id: string;
      completed_at: Date | null;
    }>('SELECT event_type, event_id, completed_at FROM webhook_outbox');

    expect(requests[0]?.state).toBe('approved');
    expect(audits).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.event_type).toBe('attendance_request.approved');
    expect(outbox[0]?.event_id).not.toBe('');
    expect(outbox[0]?.completed_at).toBeNull();
  });

  it('業務処理がロールバックすれば送信待ちも残らない', async () => {
    const response = await submitAndApprove(fixture, alwaysRollingBack(testDatabase()));

    expect(response.status).toBe(500);
    expect(await countOf('webhook_outbox')).toBe(0);
    expect(await countOf('webhook_deliveries')).toBe(0);
    expect(sent).toEqual([]);

    const requests = await testDatabase().query<{ state: string }>(
      'SELECT state FROM daily_attendance_requests',
    );
    expect(requests[0]?.state).toBe('submitted');
  });

  it('同じ送信先へ同じ出来事を二重に積めない', async () => {
    await submitAndApprove(fixture);
    const rows = await testDatabase().query<{
      workspace_id: string;
      endpoint_id: string;
      event_id: string;
      event_type: string;
      payload: unknown;
      occurred_at: Date;
    }>('SELECT * FROM webhook_outbox');
    const row = rows[0];
    if (!row) throw new Error('送信待ちがありません');

    const outbox = createWebhookOutboxRepository(testDatabase());
    await expect(
      outbox.enqueue(row.workspace_id, {
        endpointId: row.endpoint_id,
        eventType: row.event_type,
        eventId: row.event_id,
        payload: row.payload,
        occurredAt: row.occurred_at,
      }),
    ).rejects.toThrow(/webhook_outbox_event_key/);
  });
});

describe('送信ワーカー', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await submitAndApprove(fixture);
  });

  it('送信待ちを送り、履歴を残して完了させる', async () => {
    expect(await deliveringProcessor().processBatch()).toBe(1);

    const deliveries = await testDatabase().query<{ outcome: string; event_id: string }>(
      'SELECT outcome, event_id FROM webhook_deliveries',
    );
    const outbox = await testDatabase().query<{ event_id: string; completed_at: Date | null }>(
      'SELECT event_id, completed_at FROM webhook_outbox',
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://example.test/hooks');
    expect(deliveries[0]?.outcome).toBe('delivered');
    expect(outbox[0]?.completed_at).not.toBeNull();
    // 出来事の識別子は送信待ちのものをそのまま使う。受け取り側の重複排除がずれないようにする。
    expect(deliveries[0]?.event_id).toBe(outbox[0]?.event_id);
    expect(sent[0]?.headers['x-staffweave-event-id']).toBe(outbox[0]?.event_id);
  });

  it('完了した送信待ちは二度目の処理で取り出されない', async () => {
    await deliveringProcessor().processBatch();
    expect(await deliveringProcessor().processBatch()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('同時に動くワーカーが同じ送信待ちを二重に送らない', async () => {
    const results = await Promise.all([
      deliveringProcessor().processBatch(),
      deliveringProcessor().processBatch(),
    ]);

    expect(results.reduce((total, count) => total + count, 0)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(await countOf('webhook_deliveries')).toBe(1);
  });

  it('送信に失敗しても履歴を残して完了させる', async () => {
    await deliveringProcessor(500).processBatch();

    const deliveries = await testDatabase().query<{ outcome: string; status_code: number }>(
      'SELECT outcome, status_code FROM webhook_deliveries',
    );
    expect(deliveries[0]?.outcome).toBe('failed');
    expect(deliveries[0]?.status_code).toBe(500);
    expect(await deliveringProcessor().processBatch()).toBe(0);
  });

  it('応答しない送信先でも上限時間で打ち切って次へ進む', async () => {
    const hanging = processor({
      now: NOW,
      transport: () => new Promise<Response>(() => {}),
      sendTimeoutMs: 20,
    });

    await expect(hanging.processBatch()).resolves.toBe(1);

    const deliveries = await testDatabase().query<{ outcome: string; error_message: string }>(
      'SELECT outcome, error_message FROM webhook_deliveries',
    );
    expect(deliveries[0]?.outcome).toBe('failed');
    expect(deliveries[0]?.error_message).toContain('20 ミリ秒');
  });

  it('送信先を止めると送信せずに記録だけ残す', async () => {
    await testDatabase().query('UPDATE webhook_endpoints SET active = false');

    await deliveringProcessor().processBatch();

    expect(sent).toEqual([]);
    const deliveries = await testDatabase().query<{ outcome: string }>(
      'SELECT outcome FROM webhook_deliveries',
    );
    expect(deliveries[0]?.outcome).toBe('skipped');
  });
});

describe('送信待ちの取得と回復', () => {
  const LEASE_MS = 60_000;

  beforeEach(async () => {
    await submitAndApprove(await setUp());
  });

  it('取得中の送信待ちは他のワーカーが取れない', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());

    const first = await outbox.claimPending({ now: NOW, leaseMs: LEASE_MS, limit: 10 });
    const second = await outbox.claimPending({ now: NOW, leaseMs: LEASE_MS, limit: 10 });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('取得の期限が切れれば別のワーカーが同じ識別子で引き取れる', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());

    // 取得した後、完了を記録する前に停止した状態にあたる。
    const first = await outbox.claimPending({ now: NOW, leaseMs: LEASE_MS, limit: 10 });
    const afterLease = new Date(NOW.getTime() + LEASE_MS + 1);
    const second = await outbox.claimPending({ now: afterLease, leaseMs: LEASE_MS, limit: 10 });

    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[0]?.eventId).toBe(first[0]?.eventId);
    expect(second[0]?.claimToken).not.toBe(first[0]?.claimToken);
  });

  it('取得の印が一致しなければ完了できない', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());
    const [entry] = await outbox.claimPending({ now: NOW, leaseMs: LEASE_MS, limit: 10 });
    if (!entry) throw new Error('送信待ちがありません');

    expect(await outbox.complete(entry.id, randomUUID(), NOW)).toBe(false);
    expect(await outbox.complete(entry.id, entry.claimToken, NOW)).toBe(true);
    // 完了した行はもう一度完了させられない。
    expect(await outbox.complete(entry.id, entry.claimToken, NOW)).toBe(false);
  });
});
