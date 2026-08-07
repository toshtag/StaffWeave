/**
 * 自動付与が、要求してきたワークスペースの外へ触れないこと。
 *
 * 画面からの実行は、定期実行と同じ実装を呼ぶ。同じ実装が全てのワークスペースを
 * 回す形だと、1 人の管理者が押した操作が、関係のないワークスペースの台帳・
 * 実行の記録・監査まで動かす。押した本人にも、動かされた側にも見えない。
 *
 * ここで固定したいのは 2 つ。
 *
 *   A からの実行で B の付与・実行の記録・監査・台帳が一切変わらないこと
 *   同じ日を同時に処理しても、二度付与されないこと
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createAuditRepository } from '../../src/audit/repository.js';
import { createLeaveGrantScheduler } from '../../src/leave/grant-scheduler.js';
import { createLeaveRepository } from '../../src/leave/repository.js';
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

const DAY = 8 * 60;
const app = testAppFactory({ now: '2026-10-01T00:00:00.000Z' });

interface Space {
  workspaceId: string;
  employeeId: string;
  leaveTypeId: string;
  adminCookie: string;
}

let alpha: Space;
let beta: Space;

/** ワークスペースを 1 つ、自動付与が効く状態まで作る。 */
async function setUpSpace(slug: string, email: string): Promise<Space> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email, roles: ['workspace_admin'] });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '付与 花子',
    email: `employee-${slug}@example.com`,
  });
  await db.query('UPDATE employees SET hired_on = $2 WHERE id = $1', [
    employee.employeeId,
    '2025-04-01',
  ]);

  const leaveTypes = await db.query<{ id: string }>(
    `INSERT INTO leave_types
       (workspace_id, code, name, paid, unit_minutes, day_minutes,
        grant_basis, auto_grant_enabled, auto_grant_from, grant_fixed_month, grant_fixed_day)
     VALUES ($1, 'PAID', '年次有給', true, 60, $2, 'fixed_date', true, '2026-09-01', 9, 15)
     RETURNING id`,
    [workspaceId, DAY],
  );
  const leaveType = leaveTypes[0];
  if (!leaveType) throw new Error('休暇種別を用意できませんでした');

  await db.query(
    `INSERT INTO leave_grant_rules (workspace_id, leave_type_id, service_months, minutes)
     VALUES ($1, $2, 6, $3)`,
    [workspaceId, leaveType.id, 10 * DAY],
  );

  const instance = app();
  return {
    workspaceId,
    employeeId: employee.employeeId,
    leaveTypeId: leaveType.id,
    adminCookie: await loginAndGetCookie(instance, { email, workspaceSlug: slug }),
  };
}

beforeEach(async () => {
  alpha = await setUpSpace('default', 'admin-a@example.com');
  beta = await setUpSpace('beta', 'admin-b@example.com');
});

async function ledgerCount(space: Space): Promise<number> {
  const rows = await testDatabase().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM leave_ledger_entries WHERE workspace_id = $1',
    [space.workspaceId],
  );
  return Number(rows[0]?.count ?? '0');
}

async function runCount(space: Space): Promise<number> {
  const rows = await testDatabase().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM leave_grant_runs WHERE workspace_id = $1',
    [space.workspaceId],
  );
  return Number(rows[0]?.count ?? '0');
}

async function auditCount(space: Space): Promise<number> {
  const rows = await testDatabase().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_logs
      WHERE workspace_id = $1 AND action = 'leave_ledger.auto_granted'`,
    [space.workspaceId],
  );
  return Number(rows[0]?.count ?? '0');
}

async function snapshotOf(space: Space): Promise<[number, number, number]> {
  return [await ledgerCount(space), await runCount(space), await auditCount(space)];
}

async function runNow(instance: TestApp, space: Space): Promise<Response> {
  return instance.request(
    '/api/leave-grant-runs',
    authorized(space.adminCookie, { method: 'POST' }),
  );
}

describe('自動付与の実行範囲', () => {
  it('A からの実行で、B の台帳・実行の記録・監査が変わらない', async () => {
    const instance = app();
    const before = await snapshotOf(beta);

    const response = await runNow(instance, alpha);
    expect(response.status).toBe(200);

    // A は付与されている。
    expect(await ledgerCount(alpha)).toBeGreaterThan(0);
    expect(await runCount(alpha)).toBeGreaterThan(0);
    expect(await auditCount(alpha)).toBeGreaterThan(0);

    // B は 1 つも動いていない。
    expect(await snapshotOf(beta)).toEqual(before);
  });

  it('返す結果にも、他のワークスペースの実行は混ざらない', async () => {
    const instance = app();

    const response = await runNow(instance, alpha);
    const { runs } = (await response.json()) as { runs: { leaveTypeId: string }[] };

    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.leaveTypeId).toBe(alpha.leaveTypeId);
    }
  });
});

describe('同時に走らせたとき', () => {
  /** 定期実行の command と同じ入口を、独立した接続から作る。 */
  function scheduler() {
    const db = testDatabase();
    return createLeaveGrantScheduler({
      listWorkspaces: async () => [
        { id: alpha.workspaceId, slug: 'default', timeZone: 'Asia/Tokyo' },
      ],
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({ leave: createLeaveRepository(tx), audit: createAuditRepository(tx) }),
        ),
    });
  }

  /**
   * 同じ日を同時に処理させる。
   *
   * 先にその日を取ってから付与するため、取れなかった側は 1 件も積まない。
   * 付与してから記録する順だと、二度目は制約で落ちるまで付与を積むことになり、
   * 落ちる位置に結果が左右される。
   */
  it('同時に実行しても、二度付与しない', async () => {
    const outcomes = await Promise.all([
      scheduler().runAll(),
      scheduler().runAll(),
      scheduler().runAll(),
    ]);

    // どれも失敗しない。片方が「取れなかった」だけで、例外にはしない。
    const processed = outcomes.flat();
    expect(processed.length).toBe(1);

    // 台帳は 1 件だけ。実行の記録も 1 件だけ。
    expect(await ledgerCount(alpha)).toBe(1);
    expect(await runCount(alpha)).toBe(1);
    expect(await auditCount(alpha)).toBe(1);
  });

  it('画面からの実行を同時に押しても、二度付与しない', async () => {
    const instance = app();

    const responses = await Promise.all([
      runNow(instance, alpha),
      runNow(instance, alpha),
      runNow(instance, alpha),
    ]);

    for (const response of responses) expect(response.status).toBe(200);
    expect(await ledgerCount(alpha)).toBe(1);
    expect(await runCount(alpha)).toBe(1);
  });
});
