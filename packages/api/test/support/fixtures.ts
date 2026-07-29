import type { Database } from '@staffweave/db';
import type { Locale, Role } from '@staffweave/domain';
import { hashPassword } from '../../src/shared/security/password.js';

/** createApp が返すアプリケーションのうち、テストで使う部分だけを表す。 */
export interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export const TEST_PASSWORD = 'staffweave test pass';

export async function createWorkspace(
  db: Database,
  input: { slug: string; name?: string; timeZone?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name, time_zone) VALUES ($1, $2, $3) RETURNING id',
    [input.slug, input.name ?? input.slug, input.timeZone ?? 'Asia/Tokyo'],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('ワークスペースを作成できませんでした');
  return id;
}

export async function createUser(
  db: Database,
  workspaceId: string,
  input: {
    email: string;
    password?: string;
    displayName?: string;
    roles?: readonly Role[];
    locale?: Locale;
    status?: 'active' | 'suspended';
  },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO users (workspace_id, email, password_hash, display_name, locale, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      workspaceId,
      input.email,
      await hashPassword(input.password ?? TEST_PASSWORD),
      input.displayName ?? input.email,
      input.locale ?? 'ja-JP',
      input.status ?? 'active',
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('利用者を作成できませんでした');

  for (const role of input.roles ?? ['employee']) {
    await db.query('INSERT INTO user_roles (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
      workspaceId,
      id,
      role,
    ]);
  }
  return id;
}

export async function createOrganization(
  db: Database,
  workspaceId: string,
  input: { code: string; name?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    'INSERT INTO organizations (workspace_id, code, name) VALUES ($1, $2, $3) RETURNING id',
    [workspaceId, input.code, input.name ?? input.code],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('組織を作成できませんでした');
  return id;
}

/** ログインできる従業員（利用者付き）を作る。 */
export async function createEmployeeWithAccount(
  db: Database,
  workspaceId: string,
  input: {
    organizationId: string;
    employeeNumber: string;
    displayName: string;
    email: string;
    password?: string;
    roles?: readonly Role[];
    primarySiteId?: string | null;
  },
): Promise<{ employeeId: string; userId: string }> {
  const userId = await createUser(db, workspaceId, {
    email: input.email,
    ...(input.password === undefined ? {} : { password: input.password }),
    displayName: input.displayName,
    roles: input.roles ?? ['employee'],
  });

  const rows = await db.query<{ id: string }>(
    `INSERT INTO employees
       (workspace_id, organization_id, user_id, employee_number, display_name, primary_site_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      workspaceId,
      input.organizationId,
      userId,
      input.employeeNumber,
      input.displayName,
      input.primarySiteId ?? null,
    ],
  );
  const employeeId = rows[0]?.id;
  if (!employeeId) throw new Error('従業員を作成できませんでした');
  return { employeeId, userId };
}

/** Set-Cookie ヘッダーからセッション Cookie を取り出す。 */
export function sessionCookieOf(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('セッション Cookie が設定されていません');
  const value = header.split(';')[0];
  if (!value) throw new Error('セッション Cookie を解釈できません');
  return value;
}

export async function login(
  app: RequestableApp,
  input: { email: string; password?: string; workspaceSlug?: string },
): Promise<Response> {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password ?? TEST_PASSWORD,
      ...(input.workspaceSlug === undefined ? {} : { workspaceSlug: input.workspaceSlug }),
    }),
  });
}

export async function loginAndGetCookie(
  app: RequestableApp,
  input: { email: string; password?: string; workspaceSlug?: string },
): Promise<string> {
  const response = await login(app, input);
  if (response.status !== 200) {
    throw new Error(`ログインに失敗しました: ${response.status} ${await response.text()}`);
  }
  return sessionCookieOf(response);
}

export function authorized(
  cookie: string,
  init: { method?: string; body?: unknown } = {},
): RequestInit {
  return {
    method: init.method ?? 'GET',
    headers: {
      cookie,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  };
}
