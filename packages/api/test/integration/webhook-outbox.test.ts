import { randomUUID } from 'node:crypto';
import type { CreateWebhookEndpointResponse, DailyRequestRecord } from '@staffweave/contracts';
import type { Database } from '@staffweave/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import { createWebhookDeliveryWorker } from '../../src/integration/delivery-worker.js';
import { createWebhookOutboxRepository } from '../../src/integration/outbox-repository.js';
import type {
  WebhookResponseSummary,
  WebhookTransport,
} from '../../src/integration/webhook-http-transport.js';
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
import {
  createTestDeliveryProcessor,
  recordingTransport,
  testWebhookTargetValidator,
} from '../support/webhook.js';

/**
 * 承認と Webhook 送信の境界。
 *
 * API は送信待ちを業務データと同じトランザクションで記録するだけで、HTTP 送信は行わない。
 * 送信はワーカーが別に行う。ワーカーは送信の直前に 1 件だけ取り出し、未送信の行を先取りしない。
 * HTTP の失敗は自動再送しないため、到達は保証しない。
 */

const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z';
const BUSINESS_DATE = '2026-04-01';
const NOW = new Date(CLOCK_OUT_AT);

const sent: SentWebhook[] = [];

function app(db: Database = testDatabase()) {
  return createApp({
    db,
    defaultWorkspaceSlug: 'default',
    now: () => NOW,
    webhookTargetValidator: testWebhookTargetValidator(),
  });
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
    transport: recordingTransport(sent, () => status),
  });
}

async function countOf(table: string): Promise<number> {
  const rows = await testDatabase().query<{ count: number }>(`SELECT count(*) FROM ${table}`);
  return rows[0]?.count ?? 0;
}

interface Fixture {
  employeeCookie: string;
  approverCookie: string;
  endpoints: CreateWebhookEndpointResponse[];
}

/** 同じ種別を購読する送信先を指定した数だけ登録する。1 回の承認でその数だけ送信待ちができる。 */
async function setUp(options: { endpoints?: number } = {}): Promise<Fixture> {
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
  const endpoints: CreateWebhookEndpointResponse[] = [];
  for (let index = 0; index < (options.endpoints ?? 1); index += 1) {
    const registered = await instance.request(
      '/api/webhook-endpoints',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          name: `連携先 ${index + 1}`,
          url: index === 0 ? 'https://example.test/hooks' : `https://example.test/hooks-${index}`,
          eventTypes: ['attendance_request.approved'],
        },
      }),
    );
    endpoints.push((await registered.json()) as CreateWebhookEndpointResponse);
  }

  return {
    approverCookie: await loginAndGetCookie(instance, { email: 'approver@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    endpoints,
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
    expect(await deliveringProcessor().processNext()).toBe(true);

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
    await deliveringProcessor().processNext();
    expect(await deliveringProcessor().processNext()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('同時に動くワーカーが同じ送信待ちを二重に送らない', async () => {
    const results = await Promise.all([
      deliveringProcessor().processNext(),
      deliveringProcessor().processNext(),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(await countOf('webhook_deliveries')).toBe(1);
  });

  it('送信に失敗しても履歴を残して完了させる', async () => {
    await deliveringProcessor(500).processNext();

    const deliveries = await testDatabase().query<{ outcome: string; status_code: number }>(
      'SELECT outcome, status_code FROM webhook_deliveries',
    );
    expect(deliveries[0]?.outcome).toBe('failed');
    expect(deliveries[0]?.status_code).toBe(500);
    expect(await deliveringProcessor().processNext()).toBe(false);
  });

  it('応答しない送信先でも上限時間で打ち切って次へ進む', async () => {
    const hanging = processor({
      now: NOW,
      transport: () => new Promise<WebhookResponseSummary>(() => {}),
      sendTimeoutMs: 20,
    });

    await expect(hanging.processNext()).resolves.toBe(true);

    const deliveries = await testDatabase().query<{ outcome: string; error_message: string }>(
      'SELECT outcome, error_message FROM webhook_deliveries',
    );
    expect(deliveries[0]?.outcome).toBe('failed');
    expect(deliveries[0]?.error_message).toContain('20 ミリ秒');
  });

  it('送信先を止めると送信せずに記録だけ残す', async () => {
    await testDatabase().query('UPDATE webhook_endpoints SET active = false');

    await deliveringProcessor().processNext();

    expect(sent).toEqual([]);
    const deliveries = await testDatabase().query<{ outcome: string }>(
      'SELECT outcome FROM webhook_deliveries',
    );
    expect(deliveries[0]?.outcome).toBe('skipped');
  });
});

describe('複数の送信待ちがあるときのワーカー', () => {
  /** 送信を任意の時点まで止められる通信。 */
  function blockingTransport(sentTo: SentWebhook[]): {
    transport: WebhookTransport;
    started: Promise<void>;
    release: () => void;
  } {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedSending = new Promise<void>((resolve) => {
      started = resolve;
    });

    return {
      started: startedSending,
      release: () => release?.(),
      transport: async (target, headers, body) => {
        sentTo.push({ url: target.url.href, headers, body });
        started?.();
        await blocked;
        return { statusCode: 204, bodyLimitExceeded: false };
      },
    };
  }

  beforeEach(async () => {
    // 同じ種別を購読する送信先を 2 件登録し、1 回の承認で送信待ちを 2 行作る。
    const fixture = await setUp({ endpoints: 2 });
    await submitAndApprove(fixture);
    expect(await countOf('webhook_outbox')).toBe(2);
  });

  it('取得は 1 件ずつで、繰り返すと別の行が返る', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());

    const first = await outbox.claimNext({ leaseMs: 60_000 });
    const second = await outbox.claimNext({ leaseMs: 60_000 });
    const third = await outbox.claimNext({ leaseMs: 60_000 });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.id).not.toBe(second?.id);
    expect(third).toBeNull();
  });

  it('送信中のワーカーが未送信の行を抱え込まない', async () => {
    const sentByA: SentWebhook[] = [];
    const sentByB: SentWebhook[] = [];
    const blocking = blockingTransport(sentByA);

    const workerA = processor({ now: NOW, transport: blocking.transport, sendTimeoutMs: 30_000 });
    const workerB = processor({ now: NOW, transport: recordingTransport(sentByB) });

    const runningA = workerA.processNext();
    await blocking.started;

    // A が 1 件目を送っている間、残りの 1 件は他のワーカーが処理できなければならない。
    // まとめて取得すると、送信を始める前に占有期限が切れて二重送信になり得る。
    expect(await workerB.processNext()).toBe(true);
    expect(sentByB).toHaveLength(1);

    blocking.release();
    await runningA;

    expect(sentByA).toHaveLength(1);
    expect(sentByA[0]?.url).not.toBe(sentByB[0]?.url);
    expect(await countOf('webhook_deliveries')).toBe(2);
    expect(
      await testDatabase().query('SELECT id FROM webhook_outbox WHERE completed_at IS NULL'),
    ).toEqual([]);
  });

  it('停止を要求したワーカーは次の送信待ちを取りに行かない', async () => {
    const sentByWorker: SentWebhook[] = [];
    const blocking = blockingTransport(sentByWorker);
    const worker = createWebhookDeliveryWorker({
      pollIntervalMs: 60_000,
      processor: processor({
        now: NOW,
        transport: blocking.transport,
        sendTimeoutMs: 30_000,
      }),
    });

    const running = worker.run();
    await blocking.started;
    worker.stop();
    blocking.release();
    await running;

    // 送信中の 1 件だけを終わらせ、残りは次のワーカーへ残す。
    expect(sentByWorker).toHaveLength(1);
    expect(await countOf('webhook_deliveries')).toBe(1);
    expect(
      await testDatabase().query('SELECT id FROM webhook_outbox WHERE completed_at IS NULL'),
    ).toHaveLength(1);
  });
});

describe('送信待ちの取得と回復', () => {
  const LEASE_MS = 60_000;

  /** DB の現在時刻。取得の判定はすべてこの時計で行われる。 */
  async function databaseNow(): Promise<Date> {
    const rows = await testDatabase().query<{ at: Date }>('SELECT statement_timestamp() AS at');
    const at = rows[0]?.at;
    if (!at) throw new Error('DB の時刻を取得できませんでした');
    return at;
  }

  /** ワーカーが取得後に停止し、占有期限を過ぎた状態を作る。実時間は待たない。 */
  async function expireClaim(id: string): Promise<void> {
    await testDatabase().query(
      `UPDATE webhook_outbox
          SET claim_expires_at = statement_timestamp() - interval '1 millisecond'
        WHERE id = $1`,
      [id],
    );
  }

  beforeEach(async () => {
    await submitAndApprove(await setUp());
  });

  it('取得中の送信待ちは他のワーカーが取れない', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());

    const first = await outbox.claimNext({ leaseMs: LEASE_MS });
    const second = await outbox.claimNext({ leaseMs: LEASE_MS });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('取得の時刻と期限は DB が決める', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());

    const before = await databaseNow();
    const entry = await outbox.claimNext({ leaseMs: LEASE_MS });
    const after = await databaseNow();
    if (!entry) throw new Error('送信待ちがありません');

    const rows = await testDatabase().query<{ claimed_at: Date; claim_expires_at: Date }>(
      'SELECT claimed_at, claim_expires_at FROM webhook_outbox WHERE id = $1',
      [entry.id],
    );
    const claimedAt = rows[0]?.claimed_at;
    const expiresAt = rows[0]?.claim_expires_at;
    if (!claimedAt || !expiresAt) throw new Error('取得の印がありません');

    // 呼び出しの前後で挟む。プロセス側から基準時刻を注入する余地がないことを示す。
    expect(claimedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(claimedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(expiresAt.getTime() - claimedAt.getTime()).toBe(LEASE_MS);
  });

  it('取得の期限が切れれば別のワーカーが同じ識別子で引き取れる', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());

    // 取得した後、完了を記録する前に停止した状態にあたる。
    const first = await outbox.claimNext({ leaseMs: LEASE_MS });
    if (!first) throw new Error('送信待ちがありません');
    await expireClaim(first.id);
    const second = await outbox.claimNext({ leaseMs: LEASE_MS });

    expect(second).not.toBeNull();
    expect(second?.id).toBe(first.id);
    expect(second?.eventId).toBe(first.eventId);
    expect(second?.claimToken).not.toBe(first.claimToken);
  });

  it('取得の印が一致しなければ完了できない', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());
    const entry = await outbox.claimNext({ leaseMs: LEASE_MS });
    if (!entry) throw new Error('送信待ちがありません');

    expect(await outbox.complete(entry.id, randomUUID())).toBe(false);
    expect(await outbox.complete(entry.id, entry.claimToken)).toBe(true);
    // 完了した行はもう一度完了させられない。
    expect(await outbox.complete(entry.id, entry.claimToken)).toBe(false);
  });

  it('完了した行には取得の印を残さない', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());
    const entry = await outbox.claimNext({ leaseMs: LEASE_MS });
    if (!entry) throw new Error('送信待ちがありません');
    await outbox.complete(entry.id, entry.claimToken);

    const rows = await testDatabase().query<{
      completed_at: Date | null;
      claimed_at: Date | null;
      claim_expires_at: Date | null;
      claim_token: string | null;
    }>(
      `SELECT completed_at, claimed_at, claim_expires_at, claim_token
         FROM webhook_outbox WHERE id = $1`,
      [entry.id],
    );

    expect(rows[0]?.completed_at).not.toBeNull();
    expect(rows[0]?.claimed_at).toBeNull();
    expect(rows[0]?.claim_expires_at).toBeNull();
    expect(rows[0]?.claim_token).toBeNull();
    // 完了した行は再び取得されない。
    expect(await outbox.claimNext({ leaseMs: LEASE_MS })).toBeNull();
  });

  it('発生時刻が未来でも送信待ちは直ちに取得できる', async () => {
    const outbox = createWebhookOutboxRepository(testDatabase());
    const rows = await testDatabase().query<{ workspace_id: string; endpoint_id: string }>(
      'SELECT workspace_id, endpoint_id FROM webhook_outbox',
    );
    const row = rows[0];
    if (!row) throw new Error('送信待ちがありません');

    const tomorrow = new Date((await databaseNow()).getTime() + 24 * 60 * 60 * 1000);
    await outbox.enqueue(row.workspace_id, {
      endpointId: row.endpoint_id,
      eventType: 'monthly_closing.closed',
      eventId: 'future-1',
      payload: {},
      occurredAt: tomorrow,
    });

    // occurredAt は本文へ入れる業務時刻であって、送信の予定を決めない。
    const claimedIds: string[] = [];
    for (;;) {
      const entry = await outbox.claimNext({ leaseMs: LEASE_MS });
      if (!entry) break;
      claimedIds.push(entry.eventId);
    }
    expect(claimedIds).toContain('future-1');

    const stored = await testDatabase().query<{ occurred_at: Date; available_at: Date }>(
      "SELECT occurred_at, available_at FROM webhook_outbox WHERE event_id = 'future-1'",
    );
    expect(stored[0]?.occurred_at.getTime()).toBe(tomorrow.getTime());
    expect(stored[0]?.available_at.getTime()).toBeLessThan(tomorrow.getTime());
  });
});
