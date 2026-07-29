import type { SessionResponse } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import {
  authorized,
  createUser,
  createWorkspace,
  login,
  loginAndGetCookie,
  sessionCookieOf,
  TEST_PASSWORD,
} from '../support/fixtures.js';

function app() {
  return createApp({ db: testDatabase(), defaultWorkspaceSlug: 'default' });
}

describe('ローカル認証', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default', name: '既定' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      displayName: '管理 太郎',
      roles: ['workspace_admin'],
    });
  });

  it('正しい資格情報でログインできる', async () => {
    const response = await login(app(), { email: 'admin@example.com' });
    const body = (await response.json()) as SessionResponse;

    expect(response.status).toBe(200);
    expect(body.user.email).toBe('admin@example.com');
    expect(body.user.roles).toEqual(['workspace_admin']);
    expect(body.user.permissions).toContain('organization.manage');
    expect(body.workspace.slug).toBe('default');
    expect(body.employee).toBeNull();
  });

  it('セッション Cookie は HttpOnly で発行される', async () => {
    const response = await login(app(), { email: 'admin@example.com' });
    const header = response.headers.get('set-cookie') ?? '';

    expect(header).toContain('staffweave_session=');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
  });

  it('メールアドレスの大文字小文字は区別しない', async () => {
    const response = await login(app(), { email: 'ADMIN@Example.COM' });
    expect(response.status).toBe(200);
  });

  it('パスワードが違えば 401 を返す', async () => {
    const response = await login(app(), { email: 'admin@example.com', password: 'wrong password' });
    expect(response.status).toBe(401);
  });

  it('存在しないメールアドレスでも同じ応答を返す', async () => {
    const missing = await login(app(), { email: 'nobody@example.com' });
    const wrong = await login(app(), { email: 'admin@example.com', password: 'wrong password' });

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual(await wrong.json());
  });

  it('停止中の利用者はログインできない', async () => {
    await createUser(testDatabase(), workspaceId, {
      email: 'suspended@example.com',
      status: 'suspended',
    });
    const response = await login(app(), { email: 'suspended@example.com' });
    expect(response.status).toBe(401);
  });

  it('契約に合わない要求は 400 を返し、項目を示す', async () => {
    const response = await app().request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    const body = (await response.json()) as {
      error: { code: string; details?: { field: string }[] };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details?.[0]?.field).toBe('password');
  });
});

describe('セッション', () => {
  beforeEach(async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
  });

  it('Cookie が無ければ 401 を返す', async () => {
    const response = await app().request('/api/auth/session');
    expect(response.status).toBe(401);
  });

  it('無効なトークンでは 401 を返す', async () => {
    const response = await app().request(
      '/api/auth/session',
      authorized('staffweave_session=not-a-real-token'),
    );
    expect(response.status).toBe(401);
  });

  it('ログイン後はセッションを取得できる', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });
    const response = await instance.request('/api/auth/session', authorized(cookie));

    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user.email).toBe('admin@example.com');
  });

  it('ログアウト後は同じ Cookie を使えない', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

    const loggedOut = await instance.request(
      '/api/auth/logout',
      authorized(cookie, { method: 'POST' }),
    );
    expect(loggedOut.status).toBe(204);

    const response = await instance.request('/api/auth/session', authorized(cookie));
    expect(response.status).toBe(401);
  });

  it('有効期限を過ぎたセッションは使えない', async () => {
    const instance = app();
    const response = await login(instance, { email: 'admin@example.com' });
    const cookie = sessionCookieOf(response);

    // 13 時間後の時計で同じ Cookie を使う（既定の有効期間は 12 時間）。
    const later = createApp({
      db: testDatabase(),
      defaultWorkspaceSlug: 'default',
      now: () => new Date(Date.now() + 13 * 60 * 60 * 1000),
    });

    expect((await later.request('/api/auth/session', authorized(cookie))).status).toBe(401);
  });

  it('表示言語を切り替えられる', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

    const updated = await instance.request(
      '/api/auth/preferences',
      authorized(cookie, { method: 'PATCH', body: { locale: 'en' } }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as SessionResponse).user.locale).toBe('en');

    const reloaded = await instance.request('/api/auth/session', authorized(cookie));
    expect(((await reloaded.json()) as SessionResponse).user.locale).toBe('en');
  });

  it('対応していない表示言語は拒否する', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

    const response = await instance.request(
      '/api/auth/preferences',
      authorized(cookie, { method: 'PATCH', body: { locale: 'fr-FR' } }),
    );
    expect(response.status).toBe(400);
  });
});

describe('ワークスペース境界（認証）', () => {
  beforeEach(async () => {
    const first = await createWorkspace(testDatabase(), { slug: 'default' });
    const second = await createWorkspace(testDatabase(), { slug: 'other' });
    await createUser(testDatabase(), first, {
      email: 'person@example.com',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), second, {
      email: 'person@example.com',
      password: 'another workspace pass',
      roles: ['employee'],
    });
  });

  it('同じメールアドレスでもワークスペースごとに別の利用者として扱う', async () => {
    const instance = app();

    const defaultWorkspace = await login(instance, {
      email: 'person@example.com',
      password: TEST_PASSWORD,
    });
    const otherWorkspace = await login(instance, {
      email: 'person@example.com',
      password: 'another workspace pass',
      workspaceSlug: 'other',
    });

    expect(defaultWorkspace.status).toBe(200);
    expect(otherWorkspace.status).toBe(200);

    const defaultBody = (await defaultWorkspace.json()) as SessionResponse;
    const otherBody = (await otherWorkspace.json()) as SessionResponse;

    expect(defaultBody.user.id).not.toBe(otherBody.user.id);
    expect(defaultBody.user.roles).toEqual(['workspace_admin']);
    expect(otherBody.user.roles).toEqual(['employee']);
  });

  it('別ワークスペースのパスワードでは認証できない', async () => {
    const response = await login(app(), {
      email: 'person@example.com',
      password: 'another workspace pass',
    });
    expect(response.status).toBe(401);
  });

  it('存在しないワークスペースを指定しても 401 を返す', async () => {
    const response = await login(app(), {
      email: 'person@example.com',
      workspaceSlug: 'no-such-workspace',
    });
    expect(response.status).toBe(401);
  });
});
