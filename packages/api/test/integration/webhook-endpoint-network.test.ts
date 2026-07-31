import type { ErrorResponse } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import type {
  WebhookHostResolver,
  WebhookNetworkPolicyMode,
} from '../../src/integration/webhook-network-policy.js';
import { authorized, createUser, createWorkspace, loginAndGetCookie } from '../support/fixtures.js';
import {
  fixedResolver,
  PUBLIC_TEST_ADDRESS,
  testWebhookTargetValidator,
} from '../support/webhook.js';

/**
 * Webhook 送信先の登録が、内部ネットワークを指す URL を受け付けないことを確かめる。
 *
 * 名前解決は必ず偽の解決器へ差し替える。外部の DNS もクラウドのメタデータサービスも参照しない。
 */

let adminCookie: string;

function app(
  resolver: WebhookHostResolver = fixedResolver(),
  mode: WebhookNetworkPolicyMode = 'public-only',
) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    webhookTargetValidator: testWebhookTargetValidator(resolver, mode),
  });
}

async function register(
  url: string,
  resolver?: WebhookHostResolver,
  mode?: WebhookNetworkPolicyMode,
): Promise<Response> {
  return app(resolver, mode).request(
    '/api/webhook-endpoints',
    authorized(adminCookie, {
      method: 'POST',
      body: { name: '連携先', url, eventTypes: ['attendance_request.approved'] },
    }),
  );
}

async function endpointCount(): Promise<number> {
  const rows = await testDatabase().query<{ count: number }>(
    'SELECT count(*)::int AS count FROM webhook_endpoints',
  );
  return rows[0]?.count ?? 0;
}

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  adminCookie = await loginAndGetCookie(app(), { email: 'admin@example.com' });
});

describe('Webhook 送信先の登録', () => {
  // #18 の再現。これらはいずれも変更前は 201 で登録できていた。
  it.each([
    'http://127.0.0.1:8787/health',
    'http://10.0.0.1/hook',
    'http://172.16.0.1/hook',
    'http://192.168.0.1/hook',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/hook',
    'http://[fe80::1]/hook',
    'http://2130706433/hook',
  ])('%s を拒む', async (url) => {
    const response = await register(url);
    expect(response.status).toBe(400);
    expect(await endpointCount()).toBe(0);
  });

  it('拒んだ理由を url の項目に日本語で返す', async () => {
    const response = await register('http://127.0.0.1:8787/health');
    const body = (await response.json()) as ErrorResponse;

    expect(body.error.details?.[0]).toEqual({
      field: 'url',
      message: 'Webhook 送信先が許可されていないネットワークを指しています',
    });
  });

  it('ホスト名が内部アドレスへ解決されるなら拒む', async () => {
    const response = await register(
      'https://internal.example.test/hook',
      fixedResolver('10.0.0.5'),
    );
    expect(response.status).toBe(400);
    expect(await endpointCount()).toBe(0);
  });

  // 公開アドレスを混ぜれば通る、という抜け道を残さない。
  it('公開と内部が混ざった名前解決結果を拒む', async () => {
    const mixed: WebhookHostResolver = async () => [
      { address: PUBLIC_TEST_ADDRESS, family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const response = await register('https://mixed.example.test/hook', mixed);

    expect(response.status).toBe(400);
    expect(await endpointCount()).toBe(0);
  });

  it('名前を解決できない送信先を拒む', async () => {
    const response = await register('https://missing.example.test/hook', async () => {
      throw new Error('getaddrinfo ENOTFOUND missing.example.test');
    });
    expect(response.status).toBe(400);
  });

  it('公開アドレスだけへ解決されるホスト名は登録できる', async () => {
    const response = await register('https://hooks.example.test/hook');
    expect(response.status).toBe(201);
    expect(await endpointCount()).toBe(1);
  });

  it('保存する URL は正規化した形にする', async () => {
    await register('HTTPS://hooks.example.test:443/hook?b=1');

    const rows = await testDatabase().query<{ url: string }>('SELECT url FROM webhook_endpoints');
    expect(rows[0]?.url).toBe('https://hooks.example.test/hook?b=1');
  });

  it.each([
    'file:///etc/passwd',
    'http://user:password@hooks.example.test/hook',
    'https://hooks.example.test/hook#fragment',
  ])('構文が使えない %s を拒む', async (url) => {
    expect((await register(url)).status).toBe(400);
  });

  describe('allow-local', () => {
    it('明示設定のときだけループバックを登録できる', async () => {
      expect((await register('http://127.0.0.1:8787/hook')).status).toBe(400);
      expect(
        (await register('http://127.0.0.1:8787/hook', fixedResolver(), 'allow-local')).status,
      ).toBe(201);
    });

    it('明示設定でもメタデータサービスは拒む', async () => {
      const response = await register(
        'http://169.254.169.254/latest/meta-data/',
        fixedResolver(),
        'allow-local',
      );
      expect(response.status).toBe(400);
      expect(await endpointCount()).toBe(0);
    });
  });
});
