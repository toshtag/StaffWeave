import type { SessionList } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createTestApp,
  createUser,
  createWorkspace,
  login,
  loginAndGetCookie,
  TEST_PASSWORD,
} from '../support/fixtures.js';

/**
 * 自分のセッションの一覧と失効。
 *
 * 見えてよいのも終わらせてよいのも本人の分だけ。識別子を知っているだけで
 * 他人のセッションを終わらせられないこと、いま使っている 1 件を誤って
 * 終わらせないことを、経路を通して確かめる。
 */

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';

type App = ReturnType<typeof createTestApp>;

function listSessions(app: App, cookie: string): Promise<Response> {
  return Promise.resolve(app.request('/api/auth/sessions', authorized(cookie)));
}

async function sessionsOf(app: App, cookie: string): Promise<SessionList['sessions']> {
  const response = await listSessions(app, cookie);
  if (response.status !== 200) {
    throw new Error(`一覧を取得できませんでした: ${response.status}`);
  }
  return ((await response.json()) as SessionList).sessions;
}

function revokeSession(app: App, cookie: string, sessionId: string): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/auth/sessions/${sessionId}`, authorized(cookie, { method: 'DELETE' })),
  );
}

function revokeOthers(app: App, cookie: string): Promise<Response> {
  return Promise.resolve(
    app.request('/api/auth/sessions/revoke-others', authorized(cookie, { method: 'POST' })),
  );
}

/** 一覧のうち、いま使っていない 1 件。 */
async function otherSessionId(app: App, cookie: string): Promise<string> {
  const found = (await sessionsOf(app, cookie)).find((session) => !session.current);
  if (!found) throw new Error('他のセッションがありません');
  return found.id;
}

describe('自分のセッションの一覧', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default', name: '既定' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      displayName: '管理 太郎',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), workspaceId, {
      email: 'member@example.com',
      displayName: '一般 花子',
      roles: ['employee'],
    });
  });

  it('自分のセッションだけを、新しい順に返す', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });
    await loginAndGetCookie(app, { email: 'member@example.com' });

    const sessions = await sessionsOf(app, current);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.current).toBe(true);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    const issued = sessions.map((session) => session.issuedAt);
    expect([...issued].sort().reverse()).toEqual(issued);
  });

  it('端末は系統だけを返し、名乗りそのものは返さない', async () => {
    const app = createTestApp();
    const cookie = await loginAndGetCookie(app, {
      email: 'admin@example.com',
      userAgent: CHROME_ON_MAC,
    });

    const sessions = await sessionsOf(app, cookie);

    expect(sessions[0]?.device).toEqual({ os: 'macos', browser: 'chrome', kind: 'desktop' });
    expect(JSON.stringify(sessions)).not.toContain('AppleWebKit');
  });

  it('端末ごとに違う系統が付く', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com', userAgent: SAFARI_ON_IPHONE });
    const current = await loginAndGetCookie(app, {
      email: 'admin@example.com',
      userAgent: CHROME_ON_MAC,
    });

    const sessions = await sessionsOf(app, current);

    expect(sessions.map((session) => session.device?.kind)).toEqual(['desktop', 'mobile']);
  });

  it('名乗りが無ければ端末情報なしとして返す', async () => {
    const app = createTestApp();
    const cookie = await loginAndGetCookie(app, { email: 'admin@example.com' });

    expect((await sessionsOf(app, cookie))[0]?.device).toBeNull();
  });

  it('生の名乗りも送信元も保存しない', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com', userAgent: CHROME_ON_MAC });

    const rows = await testDatabase().query<Record<string, unknown>>('SELECT * FROM sessions');

    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain('Mozilla');
    expect(stored).not.toContain('AppleWebKit');
    // 版番号も型番も残さない。保存するのは系統まで。
    expect(stored).not.toContain('141.0');
    expect(Object.keys(rows[0] ?? {})).not.toContain('ip_address');
  });

  it('失効させたセッションは一覧に出ない', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    await revokeSession(app, current, await otherSessionId(app, current));

    const sessions = await sessionsOf(app, current);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
  });

  it('他のワークスペースのセッションは混ざらない', async () => {
    const otherWorkspace = await createWorkspace(testDatabase(), { slug: 'other', name: '別' });
    await createUser(testDatabase(), otherWorkspace, {
      email: 'admin@example.com',
      displayName: '別の管理者',
      roles: ['workspace_admin'],
    });

    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com', workspaceSlug: 'other' });
    const cookie = await loginAndGetCookie(app, { email: 'admin@example.com' });

    expect(await sessionsOf(app, cookie)).toHaveLength(1);
  });

  it('認証がなければ 401 を返す', async () => {
    const response = await createTestApp().request('/api/auth/sessions');
    expect(response.status).toBe(401);
  });
});

describe('セッションを 1 件失効させる', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default', name: '既定' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      displayName: '管理 太郎',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), workspaceId, {
      email: 'member@example.com',
      displayName: '一般 花子',
      roles: ['employee'],
    });
  });

  it('失効させたセッションは次の要求から使えない', async () => {
    const app = createTestApp();
    const other = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    const response = await revokeSession(app, current, await otherSessionId(app, current));

    expect(response.status).toBe(204);
    expect((await app.request('/api/auth/session', authorized(other))).status).toBe(401);
    expect((await app.request('/api/auth/session', authorized(current))).status).toBe(200);
  });

  it('いま使っているセッションは断り、そのまま使える', async () => {
    const app = createTestApp();
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const sessions = await sessionsOf(app, current);
    const currentId = sessions.find((session) => session.current)?.id ?? '';

    const response = await revokeSession(app, current, currentId);

    expect(response.status).toBe(400);
    expect((await app.request('/api/auth/session', authorized(current))).status).toBe(200);
  });

  // 識別子を知っているだけで他人のセッションを終わらせられてはいけない。
  it('他の利用者のセッションは終わらせられない', async () => {
    const app = createTestApp();
    const victim = await loginAndGetCookie(app, { email: 'member@example.com' });
    const attacker = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const victimSessionId = (await sessionsOf(app, victim))[0]?.id ?? '';

    const response = await revokeSession(app, attacker, victimSessionId);

    expect(response.status).toBe(404);
    expect((await app.request('/api/auth/session', authorized(victim))).status).toBe(200);
  });

  it('他のワークスペースのセッションは終わらせられない', async () => {
    const otherWorkspace = await createWorkspace(testDatabase(), { slug: 'other', name: '別' });
    await createUser(testDatabase(), otherWorkspace, {
      email: 'admin@example.com',
      displayName: '別の管理者',
      roles: ['workspace_admin'],
    });

    const app = createTestApp();
    const elsewhere = await loginAndGetCookie(app, {
      email: 'admin@example.com',
      workspaceSlug: 'other',
    });
    const here = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const elsewhereSessionId = (await sessionsOf(app, elsewhere))[0]?.id ?? '';

    const response = await revokeSession(app, here, elsewhereSessionId);

    expect(response.status).toBe(404);
    expect((await app.request('/api/auth/session', authorized(elsewhere))).status).toBe(200);
  });

  // 「無い」と「自分のものではない」を応答から区別できないようにする。
  it('存在しない識別子も、すでに失効した識別子も同じ応答にする', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const target = await otherSessionId(app, current);

    expect((await revokeSession(app, current, target)).status).toBe(204);
    expect((await revokeSession(app, current, target)).status).toBe(404);
    expect((await revokeSession(app, current, '00000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
  });

  it('失効させた事実だけを監査記録へ残す', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com', userAgent: CHROME_ON_MAC });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    await revokeSession(app, current, await otherSessionId(app, current));

    const rows = await testDatabase().query<{ summary: string; target_type: string }>(
      "SELECT summary, target_type FROM audit_logs WHERE action = 'auth.session_revoked'",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_type).toBe('session');
    expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);
  });
});

describe('他の端末からログアウトする', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default', name: '既定' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      displayName: '管理 太郎',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), workspaceId, {
      email: 'member@example.com',
      displayName: '一般 花子',
      roles: ['employee'],
    });
  });

  it('手元だけ残し、他はすべて失効させる', async () => {
    const app = createTestApp();
    const first = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const second = await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    const response = await revokeOthers(app, current);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: 2 });
    expect((await app.request('/api/auth/session', authorized(first))).status).toBe(401);
    expect((await app.request('/api/auth/session', authorized(second))).status).toBe(401);
    expect((await app.request('/api/auth/session', authorized(current))).status).toBe(200);
    expect(await sessionsOf(app, current)).toHaveLength(1);
  });

  it('他が無ければ 0 件として成功する', async () => {
    const app = createTestApp();
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    expect(await (await revokeOthers(app, current)).json()).toEqual({ revoked: 0 });
    expect(await (await revokeOthers(app, current)).json()).toEqual({ revoked: 0 });
  });

  it('他の利用者のセッションは巻き込まない', async () => {
    const app = createTestApp();
    const other = await loginAndGetCookie(app, { email: 'member@example.com' });
    await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    expect(await (await revokeOthers(app, current)).json()).toEqual({ revoked: 1 });
    expect((await app.request('/api/auth/session', authorized(other))).status).toBe(200);
  });

  it('他のワークスペースのセッションは巻き込まない', async () => {
    const otherWorkspace = await createWorkspace(testDatabase(), { slug: 'other', name: '別' });
    await createUser(testDatabase(), otherWorkspace, {
      email: 'admin@example.com',
      displayName: '別の管理者',
      roles: ['workspace_admin'],
    });

    const app = createTestApp();
    const elsewhere = await loginAndGetCookie(app, {
      email: 'admin@example.com',
      workspaceSlug: 'other',
    });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    expect(await (await revokeOthers(app, current)).json()).toEqual({ revoked: 0 });
    expect((await app.request('/api/auth/session', authorized(elsewhere))).status).toBe(200);
  });

  it('失効させた件数を監査記録へ残す', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    await revokeOthers(app, current);

    const rows = await testDatabase().query<{ detail: { revokedSessions: number } }>(
      "SELECT detail FROM audit_logs WHERE action = 'auth.other_sessions_revoked'",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail.revokedSessions).toBe(1);
  });

  it('認証がなければ 401 を返す', async () => {
    const response = await createTestApp().request('/api/auth/sessions/revoke-others', {
      method: 'POST',
    });
    expect(response.status).toBe(401);
  });
});

describe('パスワードの変更との関係', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createWorkspace(testDatabase(), { slug: 'default', name: '既定' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      displayName: '管理 太郎',
      roles: ['workspace_admin'],
    });
  });

  // 残す 1 件は識別子で決める。同じ Cookie を持たない経路からでも手元が残る。
  it('パスワードを変えても、変えた本人のセッションは一覧に残る', async () => {
    const app = createTestApp();
    await loginAndGetCookie(app, { email: 'admin@example.com' });
    const current = await loginAndGetCookie(app, { email: 'admin@example.com' });

    await app.request(
      '/api/auth/password',
      authorized(current, {
        method: 'POST',
        body: { currentPassword: TEST_PASSWORD, newPassword: 'staffweave rotated pass' },
      }),
    );

    const sessions = await sessionsOf(app, current);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
  });

  it('変更後に開いたセッションは、変更前のものと入れ替わる', async () => {
    const app = createTestApp();
    const before = await loginAndGetCookie(app, { email: 'admin@example.com' });

    await app.request(
      '/api/auth/password',
      authorized(before, {
        method: 'POST',
        body: { currentPassword: TEST_PASSWORD, newPassword: 'staffweave rotated pass' },
      }),
    );
    const after = await loginAndGetCookie(app, {
      email: 'admin@example.com',
      password: 'staffweave rotated pass',
    });

    expect((await login(app, { email: 'admin@example.com' })).status).toBe(401);
    expect(await sessionsOf(app, after)).toHaveLength(2);
  });
});
