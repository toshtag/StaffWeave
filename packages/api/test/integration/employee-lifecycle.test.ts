/**
 * 従業員の更新・休止・退職。
 *
 * 保持の手順は、退職時に状態を `retired` へ変えることを求めている。しかし
 * 従業員は一覧と作成しかなく、状態を変える経路が製品に無かった。正規の
 * 手順を、製品の外（SQL）でしか実行できない状態だった。
 *
 * ここで固定したいのは 4 つ。
 *
 *   状態を変えられること。履歴は消えないこと
 *   休止と退職で、入っている経路が閉じること
 *   理由を必ず残すこと
 *   権限の無い相手には変えられないこと
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
  testAppFactory,
} from '../support/fixtures.js';

const app = testAppFactory({ now: '2026-04-01T00:00:00.000Z' });

interface Fixture {
  workspaceId: string;
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '退職 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  fixture = {
    workspaceId,
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
});

async function changeStatus(
  instance: TestApp,
  status: string,
  cookie = fixture.adminCookie,
  reason = '手続きのため',
): Promise<Response> {
  return instance.request(
    `/api/employees/${fixture.employeeId}/status`,
    authorized(cookie, { method: 'POST', body: { status, reason } }),
  );
}

async function employeeCount(): Promise<number> {
  const rows = await testDatabase().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM employees WHERE workspace_id = $1',
    [fixture.workspaceId],
  );
  return Number(rows[0]?.count ?? '0');
}

describe('従業員の更新', () => {
  it('内容を直せる。触れなかった項目は残る', async () => {
    const instance = app();
    const response = await instance.request(
      `/api/employees/${fixture.employeeId}`,
      authorized(fixture.adminCookie, { method: 'PATCH', body: { hiredOn: '2025-04-01' } }),
    );
    const updated = (await response.json()) as { hiredOn: string; displayName: string };

    expect(response.status).toBe(200);
    expect(updated.hiredOn).toBe('2025-04-01');
    expect(updated.displayName).toBe('退職 花子');
  });

  it('権限が無ければ直せない', async () => {
    const instance = app();
    const response = await instance.request(
      `/api/employees/${fixture.employeeId}`,
      authorized(fixture.employeeCookie, { method: 'PATCH', body: { hiredOn: '2025-04-01' } }),
    );

    expect(response.status).toBe(403);
  });
});

describe('休止と退職', () => {
  it('休止すると、入っているセッションが閉じる', async () => {
    const instance = app();
    const response = await changeStatus(instance, 'suspended');
    const outcome = (await response.json()) as {
      employee: { status: string };
      revokedSessions: number;
      revokedCards: number;
    };

    expect(response.status).toBe(200);
    expect(outcome.employee.status).toBe('suspended');
    expect(outcome.revokedSessions).toBeGreaterThan(0);
    // カードは退職のときだけ失効させる。休止は戻ることが前提。
    expect(outcome.revokedCards).toBe(0);

    // 閉じたセッションでは読めない。
    const after = await instance.request(
      '/api/attendance/days/2026-04-01',
      authorized(fixture.employeeCookie),
    );
    expect(after.status).toBe(401);
  });

  it('休止から復帰できる', async () => {
    const instance = app();
    await changeStatus(instance, 'suspended');
    const response = await changeStatus(instance, 'active');
    const outcome = (await response.json()) as { employee: { status: string } };

    expect(response.status).toBe(200);
    expect(outcome.employee.status).toBe('active');
  });

  it('退職しても、従業員の行は消えない', async () => {
    const instance = app();
    const before = await employeeCount();

    const response = await changeStatus(instance, 'retired');
    expect(response.status).toBe(200);

    // 消すと、その人の打刻と計算が参照先を失う。
    expect(await employeeCount()).toBe(before);
  });

  it('理由の無い変更は受け付けない', async () => {
    const instance = app();
    const response = await changeStatus(instance, 'retired', fixture.adminCookie, '');

    expect(response.status).toBe(400);
  });

  it('変更の理由が監査へ残る', async () => {
    const instance = app();
    await changeStatus(instance, 'retired', fixture.adminCookie, '契約満了のため');

    const rows = await testDatabase().query<{ summary: string; detail: Record<string, unknown> }>(
      `SELECT summary, detail FROM audit_logs
        WHERE workspace_id = $1 AND action = 'employee.status_changed'`,
      [fixture.workspaceId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({
      from: 'active',
      to: 'retired',
      reason: '契約満了のため',
    });
  });

  it('権限が無ければ状態を変えられない', async () => {
    const instance = app();
    const response = await changeStatus(instance, 'retired', fixture.employeeCookie);

    expect(response.status).toBe(403);
  });
});
