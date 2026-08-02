import { createHmac } from 'node:crypto';
import { createConnector, deriveWebhookSigningKey, verifyWebhook } from '@staffweave/connector';
import type {
  ApiKeyList,
  CreateApiKeyResponse,
  CreateWebhookEndpointResponse,
  DailyRequestRecord,
  ImportResult,
} from '@staffweave/contracts';
import { canonicalWebhookMessage, parseCsv } from '@staffweave/domain';
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
import type { SentWebhook } from '../support/webhook.js';
import {
  createTestDeliveryProcessor,
  drain,
  recordingTransport,
  testWebhookTargetValidator,
} from '../support/webhook.js';

const CLOCK_IN_AT = '2026-04-01T00:00:00.000Z';
const CLOCK_OUT_AT = '2026-04-01T09:00:00.000Z';
const BUSINESS_DATE = '2026-04-01';

const sent: SentWebhook[] = [];

function app(now: string = CLOCK_OUT_AT) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(now),
    webhookTargetValidator: testWebhookTargetValidator(),
  });
}

/** 送信待ちが無くなるまでワーカーを動かす。API 自身は HTTP 送信を行わない。 */
async function runDeliveryWorker(status = 204): Promise<void> {
  await drain(
    createTestDeliveryProcessor(testDatabase(), {
      now: new Date(CLOCK_OUT_AT),
      transport: recordingTransport(sent, () => status),
    }),
  );
}

type App = ReturnType<typeof app>;

interface Fixture {
  adminCookie: string;
  approverCookie: string;
  employeeCookie: string;
  organizationId: string;
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
  return {
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    approverCookie: await loginAndGetCookie(instance, { email: 'approver@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    organizationId,
  };
}

async function punchWholeDay(instance: App, cookie: string): Promise<void> {
  for (const [eventType, occurredAt] of [
    ['clock_in', CLOCK_IN_AT],
    ['clock_out', CLOCK_OUT_AT],
  ] as const) {
    await instance.request(
      '/api/attendance/events',
      authorized(cookie, {
        method: 'POST',
        body: { eventType, requestId: `export-${eventType}`, occurredAt },
      }),
    );
  }
}

describe('CSV 出力', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await punchWholeDay(app(), fixture.employeeCookie);
  });

  it('日次の勤怠を CSV で出せる', async () => {
    const response = await app().request(
      '/api/exports/attendance.csv?from=2026-04-01&to=2026-04-30',
      authorized(fixture.adminCookie),
    );
    const rows = parseCsv(await response.text()).rows;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employee_number).toBe('E001');
    expect(rows[0]?.worked_minutes).toBe('540');
  });

  it('月次の集計を給与連携向けに出せる', async () => {
    const response = await app().request(
      '/api/exports/payroll.csv?period=2026-04-01',
      authorized(fixture.adminCookie),
    );
    const rows = parseCsv(await response.text()).rows;

    expect(rows[0]?.employee_number).toBe('E001');
    expect(rows[0]?.worked_minutes).toBe('540');
    expect(rows[0]?.working_days).toBe('1');
    expect(rows[0]?.closing_state).toBe('open');
  });

  it('期間の指定が不正なら 400 を返す', async () => {
    const response = await app().request(
      '/api/exports/attendance.csv?from=2026-04-30&to=2026-04-01',
      authorized(fixture.adminCookie),
    );
    expect(response.status).toBe(400);
  });

  // 契約は from・to・period を必須にしている。読み落として空文字で先へ進めない。
  it.each([
    ['/api/exports/attendance.csv', '期間を指定しない勤怠の出力'],
    ['/api/exports/attendance.csv?from=2026-04-01', '終わりを指定しない勤怠の出力'],
    ['/api/exports/attendance.csv?from=2026-04-01&to=2026-04', '日付として読めない終わり'],
    ['/api/exports/payroll.csv', '対象月を指定しない給与連携の出力'],
    ['/api/exports/payroll.csv?period=2026-04-15', '月の 1 日ではない対象月'],
  ])('%s は 400 を返す（%s）', async (path) => {
    const response = await app().request(path, authorized(fixture.adminCookie));
    expect(response.status).toBe(400);
  });

  it('従業員ロールは出力できない', async () => {
    const response = await app().request(
      '/api/exports/attendance.csv?from=2026-04-01&to=2026-04-30',
      authorized(fixture.employeeCookie),
    );
    expect(response.status).toBe(403);
  });

  it('表計算で数式として動く表示名を、そのままの値として出す', async () => {
    // 表示名は登録できる文字を選べる。出力を開く相手の画面で数式が動かないようにする。
    const formulaName = '=HYPERLINK("http://example.com","社内資料")';
    await testDatabase().query(
      'UPDATE employees SET display_name = $1 WHERE employee_number = $2',
      [formulaName, 'E001'],
    );

    for (const path of [
      '/api/exports/attendance.csv?from=2026-04-01&to=2026-04-30',
      '/api/exports/payroll.csv?period=2026-04-01',
    ]) {
      const csv = await (await app().request(path, authorized(fixture.adminCookie))).text();

      // 出力の中では印が付き、読み戻すと元の値へ戻る。
      expect(csv).toContain('"\'=HYPERLINK');
      expect(parseCsv(csv).rows[0]?.display_name).toBe(formulaName);
    }
  });
});

describe('CSV 取り込み', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('従業員を取り込める', async () => {
    const csv = [
      '"organization_code","employee_number","display_name"',
      '"HQ","E010","取込 一郎"',
      '"HQ","E011","取込 二郎"',
    ].join('\n');

    const response = await app().request('/api/imports/employees', {
      method: 'POST',
      headers: { cookie: fixture.adminCookie, 'content-type': 'text/csv' },
      body: csv,
    });
    const body = (await response.json()) as ImportResult;

    expect(response.status).toBe(200);
    expect(body.created).toBe(2);
    expect(body.problems).toEqual([]);
  });

  it('取り込めなかった行を位置つきで返す', async () => {
    const csv = [
      '"organization_code","employee_number","display_name"',
      '"MISSING","E020","組織なし"',
      '"HQ","E021","取込 三郎"',
    ].join('\n');

    const response = await app().request('/api/imports/employees', {
      method: 'POST',
      headers: { cookie: fixture.adminCookie, 'content-type': 'text/csv' },
      body: csv,
    });
    const body = (await response.json()) as ImportResult;

    expect(body.created).toBe(1);
    expect(body.problems[0]?.line).toBe(2);
    expect(body.problems[0]?.message).toContain('MISSING');
  });

  it('見出しが足りなければ 400 を返す', async () => {
    const response = await app().request('/api/imports/employees', {
      method: 'POST',
      headers: { cookie: fixture.adminCookie, 'content-type': 'text/csv' },
      body: '"employee_number"\n"E030"',
    });
    expect(response.status).toBe(400);
  });
});

describe('API キー', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await punchWholeDay(app(), fixture.employeeCookie);
  });

  async function createKey(instance: App, scopes: string[]): Promise<CreateApiKeyResponse> {
    const response = await instance.request(
      '/api/api-keys',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { name: '給与連携', scopes },
      }),
    );
    return (await response.json()) as CreateApiKeyResponse;
  }

  it('作成時にだけ生の鍵を返し、一覧には含めない', async () => {
    const instance = app();
    const created = await createKey(instance, ['payroll:read']);

    expect(created.secret).toMatch(/^sw_[0-9a-f]{8}_/);
    expect(created.apiKey.prefix).toHaveLength(8);

    const listed = await instance.request('/api/api-keys', authorized(fixture.adminCookie));
    const body = (await listed.json()) as ApiKeyList;

    expect(JSON.stringify(body)).not.toContain(created.secret);
  });

  it('与えたスコープの出力だけを許す', async () => {
    const instance = app();
    const created = await createKey(instance, ['payroll:read']);

    const allowed = await instance.request('/api/exports/payroll.csv?period=2026-04-01', {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(allowed.status).toBe(200);

    const denied = await instance.request(
      '/api/exports/attendance.csv?from=2026-04-01&to=2026-04-30',
      { headers: { authorization: `Bearer ${created.secret}` } },
    );
    expect(denied.status).toBe(400);
  });

  it('失効した鍵は使えない', async () => {
    const instance = app();
    const created = await createKey(instance, ['payroll:read']);
    await instance.request(
      `/api/api-keys/${created.apiKey.id}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );

    const response = await instance.request('/api/exports/payroll.csv?period=2026-04-01', {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(response.status).toBe(401);
  });

  it('最後に使った時刻は、間隔の中では書き直さない', async () => {
    const instance = app();
    const created = await createKey(instance, ['payroll:read']);

    async function usePayrollExport(at: string): Promise<void> {
      const response = await app(at).request('/api/exports/payroll.csv?period=2026-04-01', {
        headers: { authorization: `Bearer ${created.secret}` },
      });
      expect(response.status).toBe(200);
    }

    async function lastUsedAt(): Promise<Date | null> {
      const rows = await testDatabase().query<{ last_used_at: Date | null }>(
        'SELECT last_used_at FROM api_keys WHERE id = $1',
        [created.apiKey.id],
      );
      return rows[0]?.last_used_at ?? null;
    }

    await usePayrollExport(CLOCK_OUT_AT);
    const first = await lastUsedAt();
    expect(first).not.toBeNull();

    // 既定の間隔（60 秒）の中で使う。記録は動かない。
    await usePayrollExport('2026-04-01T09:00:30.000Z');
    expect(await lastUsedAt()).toEqual(first);

    // 間隔を過ぎてから使う。記録が進む。
    await usePayrollExport('2026-04-01T09:05:00.000Z');
    expect(await lastUsedAt()).toEqual(new Date('2026-04-01T09:05:00.000Z'));
  });

  it('不明な鍵では認証されない', async () => {
    const response = await app().request('/api/exports/payroll.csv?period=2026-04-01', {
      headers: { authorization: 'Bearer sw_00000000_unknown' },
    });
    expect(response.status).toBe(401);
  });

  it('connector から API キーで取得できる', async () => {
    const instance = app();
    const created = await createKey(instance, ['payroll:read']);

    // connector は fetch を使うため、テストではアプリの request へ差し替える。
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
      instance.request(
        new URL(String(input)).pathname + new URL(String(input)).search,
        init,
      )) as typeof fetch;

    try {
      const connector = createConnector({
        baseUrl: 'http://localhost',
        apiKey: created.secret,
      });
      const rows = await connector.fetchPayroll({ period: '2026-04-01' });
      expect(rows[0]?.employee_number).toBe('E001');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('従業員ロールは API キーを作れない', async () => {
    const response = await app().request(
      '/api/api-keys',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { name: '勝手な鍵', scopes: ['payroll:read'] },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('Webhook', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    await punchWholeDay(app(), fixture.employeeCookie);
  });

  async function registerEndpoint(
    instance: App,
    eventTypes: string[] = ['attendance_request.approved'],
  ): Promise<CreateWebhookEndpointResponse> {
    const response = await instance.request(
      '/api/webhook-endpoints',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { name: '給与システム', url: 'https://example.test/hooks', eventTypes },
      }),
    );
    return (await response.json()) as CreateWebhookEndpointResponse;
  }

  async function approve(instance: App): Promise<void> {
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
  }

  it('承認すると登録した送信先へ通知する', async () => {
    const instance = app();
    await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://example.test/hooks');
    expect(sent[0]?.headers['x-staffweave-event']).toBe('attendance_request.approved');

    const rows = await testDatabase().query<{ outcome: string }>(
      'SELECT outcome FROM webhook_deliveries',
    );
    expect(rows[0]?.outcome).toBe('delivered');
  });

  it('受け取り側が署名を検証できる', async () => {
    const instance = app();
    const endpoint = await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    const delivery = sent[0];
    expect(delivery).toBeDefined();
    if (!delivery) return;

    const verified = verifyWebhook(
      endpoint.secret,
      {
        headers: {
          'x-staffweave-event': delivery.headers['x-staffweave-event'],
          'x-staffweave-event-id': delivery.headers['x-staffweave-event-id'],
          'x-staffweave-timestamp': delivery.headers['x-staffweave-timestamp'],
          'x-staffweave-signature': delivery.headers['x-staffweave-signature'],
        },
        body: delivery.body,
      },
      { now: new Date(CLOCK_OUT_AT) },
    );

    expect(verified.eventType).toBe('attendance_request.approved');
  });

  it('保存された値だけで Webhook 署名を生成できる', async () => {
    const instance = app();
    await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    const delivery = sent[0];
    if (!delivery) throw new Error('通知が送られていません');

    const rows = await testDatabase().query<{ signing_key: string }>(
      'SELECT signing_key FROM webhook_endpoints',
    );
    const stored = rows[0]?.signing_key;
    if (!stored) throw new Error('送信先が登録されていません');

    // 保存値は照合用のハッシュではなく、そのまま HMAC の鍵になる。
    // データベースを読める者は正当な署名を作れる、という事実をここで固定する。
    const forged = createHmac('sha256', stored)
      .update(
        canonicalWebhookMessage({
          eventId: delivery.headers['x-staffweave-event-id'] ?? '',
          eventType: delivery.headers['x-staffweave-event'] ?? '',
          timestamp: delivery.headers['x-staffweave-timestamp'] ?? '',
          body: delivery.body,
        }),
        'utf8',
      )
      .digest('base64');

    expect(forged).toBe(delivery.headers['x-staffweave-signature']);
  });

  it('保存する署名鍵は登録時の秘密から導いた値になる', async () => {
    const instance = app();
    const endpoint = await registerEndpoint(instance);

    const rows = await testDatabase().query<{ signing_key: string }>(
      'SELECT signing_key FROM webhook_endpoints',
    );
    const stored = rows[0]?.signing_key;

    // 送信側と受け取り側が同じ手順で鍵を導いている、という前提をここで固定する。
    expect(stored).toBe(deriveWebhookSigningKey(endpoint.secret));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    // 応答で返す秘密と保存値は別の文字列。保存値をそのまま返してはいない。
    expect(stored).not.toBe(endpoint.secret);
  });

  it('署名鍵は API の応答へ現れない', async () => {
    const instance = app();
    const endpoint = await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    const rows = await testDatabase().query<{ signing_key: string }>(
      'SELECT signing_key FROM webhook_endpoints',
    );
    const signingKey = rows[0]?.signing_key;
    if (!signingKey) throw new Error('送信先が登録されていません');

    const listed = await instance.request(
      '/api/webhook-endpoints',
      authorized(fixture.adminCookie),
    );
    const deliveries = await instance.request(
      '/api/webhook-deliveries',
      authorized(fixture.adminCookie),
    );

    expect(JSON.stringify(endpoint.endpoint)).not.toContain(signingKey);
    expect(await listed.text()).not.toContain(signingKey);
    expect(await deliveries.text()).not.toContain(signingKey);
  });

  it('別の秘密では署名が一致しない', async () => {
    const instance = app();
    await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    const delivery = sent[0];
    if (!delivery) throw new Error('通知が送られていません');

    expect(() =>
      verifyWebhook(
        'another-secret',
        {
          headers: {
            'x-staffweave-event': delivery.headers['x-staffweave-event'],
            'x-staffweave-event-id': delivery.headers['x-staffweave-event-id'],
            'x-staffweave-timestamp': delivery.headers['x-staffweave-timestamp'],
            'x-staffweave-signature': delivery.headers['x-staffweave-signature'],
          },
          body: delivery.body,
        },
        { now: new Date(CLOCK_OUT_AT) },
      ),
    ).toThrow(/署名が一致しません/);
  });

  it('古い通知は受け付けない', async () => {
    const instance = app();
    const endpoint = await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    const delivery = sent[0];
    if (!delivery) throw new Error('通知が送られていません');

    expect(() =>
      verifyWebhook(
        endpoint.secret,
        {
          headers: {
            'x-staffweave-event': delivery.headers['x-staffweave-event'],
            'x-staffweave-event-id': delivery.headers['x-staffweave-event-id'],
            'x-staffweave-timestamp': delivery.headers['x-staffweave-timestamp'],
            'x-staffweave-signature': delivery.headers['x-staffweave-signature'],
          },
          body: delivery.body,
        },
        { now: new Date('2026-04-02T00:00:00.000Z') },
      ),
    ).toThrow(/送信時刻/);
  });

  it('登録していない種別では通知しない', async () => {
    const instance = app();
    await registerEndpoint(instance, ['monthly_closing.closed']);
    await approve(instance);
    await runDeliveryWorker();

    expect(sent).toHaveLength(0);
  });

  it('送信に失敗しても承認は成立し、記録が残る', async () => {
    const instance = app();
    await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker(500);

    const rows = await testDatabase().query<{ outcome: string; status_code: number }>(
      'SELECT outcome, status_code FROM webhook_deliveries',
    );
    expect(rows[0]?.outcome).toBe('failed');
    expect(rows[0]?.status_code).toBe(500);

    const requests = await testDatabase().query<{ state: string }>(
      'SELECT state FROM daily_attendance_requests',
    );
    expect(requests[0]?.state).toBe('approved');
  });

  it('送信結果は書き換えられない', async () => {
    const instance = app();
    await registerEndpoint(instance);
    await approve(instance);
    await runDeliveryWorker();

    await expect(testDatabase().query('DELETE FROM webhook_deliveries')).rejects.toThrow(
      /追記のみ/,
    );
  });
});
