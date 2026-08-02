import type { Database } from '@staffweave/db';
import type { Locale, Role } from '@staffweave/domain';
import { testDatabase } from '../../../../test/integration-setup.js';
import type { AppDependencies } from '../../src/app.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/shared/security/password.js';

/** createApp が返すアプリケーションのうち、テストで使う部分だけを表す。 */
export interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export const TEST_PASSWORD = 'staffweave test pass';

/**
 * 統合テストが使うワークスペース。
 *
 * ログイン時の既定（`defaultWorkspaceSlug`）と、実際に作るワークスペースは
 * 対で意味を持つ。片方だけを変えるとログインできなくなるため、同じ値を共有する。
 */
export const TEST_WORKSPACE_SLUG = 'default';

export type TestApp = ReturnType<typeof createApp>;

export interface TestAppOptions
  extends Omit<AppDependencies, 'db' | 'defaultWorkspaceSlug' | 'now'> {
  /** 既定は統合テスト用のデータベース。別の接続で確かめたい場合だけ渡す。 */
  db?: Database;
  /**
   * 現在時刻。
   *
   * 止まった時刻でよければ絶対時刻の文字列を、テストの中で進めたい場合は関数を渡す。
   * 渡し方を経路ごとに変えないよう、受け取れる形はこの 2 つに限る。
   */
  now?: string | (() => Date);
}

/** 統合テスト用のアプリ。データベースと既定のワークスペースはここで決める。 */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const { db, now, ...rest } = options;
  return createApp({
    ...rest,
    db: db ?? testDatabase(),
    defaultWorkspaceSlug: TEST_WORKSPACE_SLUG,
    ...(now === undefined ? {} : { now: typeof now === 'string' ? () => new Date(now) : now }),
  });
}

/**
 * 既定を決めた、そのファイル用のアプリ生成。
 *
 * ファイルごとに違うのは既定の時刻や鍵だけで、組み立て方は同じにする。
 */
export function testAppFactory(
  defaults: TestAppOptions = {},
): (options?: TestAppOptions) => TestApp {
  return (options = {}) => createTestApp({ ...defaults, ...options });
}

export async function createWorkspace(
  db: Database,
  input: { slug?: string; name?: string; timeZone?: string } = {},
): Promise<string> {
  const slug = input.slug ?? TEST_WORKSPACE_SLUG;
  const rows = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name, time_zone) VALUES ($1, $2, $3) RETURNING id',
    [slug, input.name ?? slug, input.timeZone ?? 'Asia/Tokyo'],
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

/**
 * 組織管理者へ閲覧範囲を与える。
 *
 * 組織管理者は、与えられた範囲の従業員だけを扱える。
 * 範囲を与えないと管理対象を持たないため、承認や一覧を試すテストでは必ず与える。
 */
export async function grantOrganizationScope(
  db: Database,
  workspaceId: string,
  input: { userId: string; organizationId: string },
): Promise<void> {
  await db.query(
    `INSERT INTO user_organization_scopes (workspace_id, user_id, organization_id)
     VALUES ($1, $2, $3)`,
    [workspaceId, input.userId, input.organizationId],
  );
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
