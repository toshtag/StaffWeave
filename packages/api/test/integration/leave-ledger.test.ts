/**
 * 休暇台帳。
 *
 * 残数は保存せず、台帳から組み立てる。ここで固定したいのは 2 つ。
 *
 *   台帳を積み直せば同じ残数になること
 *   負の残数と二重の反映を、DB の制約まで含めて拒めること
 *
 * 取得の単位や失効の月数は事業者が決める。製品は既定値を持たない。
 */
import type { LeaveBalanceRecord, LeaveLedgerEntryRecord } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createTestApp,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

interface Fixture {
  adminCookie: string;
  employeeCookie: string;
  employeeId: string;
  paidLeaveId: string;
}

const app = (): TestApp => createTestApp();

const DAY = 8 * 60;

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '休暇 花子',
    email: 'hanako@example.com',
  });

  const leaveTypes = await db.query<{ id: string }>(
    `INSERT INTO leave_types (workspace_id, code, name, paid) VALUES ($1, 'PAID', '年次有給', true)
     RETURNING id`,
    [workspaceId],
  );
  const paidLeave = leaveTypes[0];
  if (!paidLeave) throw new Error('休暇種別を用意できませんでした');

  const instance = app();
  return {
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    employeeId: employee.employeeId,
    paidLeaveId: paidLeave.id,
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setUp();
});

async function grant(instance: TestApp, body: Record<string, unknown>): Promise<Response> {
  return instance.request(
    '/api/leave-ledger/grants',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: {
        employeeId: fixture.employeeId,
        leaveTypeId: fixture.paidLeaveId,
        effectiveOn: '2026-04-01',
        ...body,
      },
    }),
  );
}

async function balanceOf(instance: TestApp, asOf: string): Promise<LeaveBalanceRecord | undefined> {
  const response = await instance.request(
    `/api/leave-balances?employeeId=${fixture.employeeId}&asOf=${asOf}`,
    authorized(fixture.adminCookie),
  );
  const body = (await response.json()) as { balances: LeaveBalanceRecord[] };
  return body.balances.find((balance) => balance.leaveTypeId === fixture.paidLeaveId);
}

describe('付与と残数', () => {
  it('付与した分が残数になる', async () => {
    const instance = app();
    expect((await grant(instance, { minutes: 10 * DAY })).status).toBe(201);

    expect(await balanceOf(instance, '2026-04-30')).toMatchObject({
      availableMinutes: 10 * DAY,
      expiredMinutes: 0,
    });
  });

  it('付与日より前の時点では残数へ入らない', async () => {
    const instance = app();
    await grant(instance, { minutes: 10 * DAY, effectiveOn: '2026-10-01' });

    // 台帳には記録があるが、その日にはまだ効いていない。
    expect(await balanceOf(instance, '2026-04-30')).toMatchObject({ availableMinutes: 0 });
  });

  it('失効の月数を設定すると、その日を過ぎた付与は残らない', async () => {
    const instance = app();
    const updated = await instance.request(
      `/api/leave-type-settings/${fixture.paidLeaveId}`,
      authorized(fixture.adminCookie, {
        method: 'PATCH',
        body: { unitMinutes: 60, dayMinutes: DAY, expiresAfterMonths: 24 },
      }),
    );
    expect(updated.status).toBe(200);

    const response = await grant(instance, { minutes: 10 * DAY });
    const entry = (await response.json()) as LeaveLedgerEntryRecord;
    expect(entry.expiresOn).toBe('2028-04-01');

    expect(await balanceOf(instance, '2028-03-31')).toMatchObject({
      availableMinutes: 10 * DAY,
    });
    expect(await balanceOf(instance, '2028-04-02')).toMatchObject({
      availableMinutes: 0,
      expiredMinutes: 10 * DAY,
    });
  });

  it('失効の月数を設定しなければ、付与は失効しない', async () => {
    const instance = app();
    const response = await grant(instance, { minutes: 10 * DAY });

    expect(((await response.json()) as LeaveLedgerEntryRecord).expiresOn).toBeNull();
    expect(await balanceOf(instance, '2099-12-31')).toMatchObject({
      availableMinutes: 10 * DAY,
    });
  });
});

describe('台帳の書き換え', () => {
  it('積んだ記録は書き換えられない', async () => {
    const instance = app();
    const entry = (await (await grant(instance, { minutes: 10 * DAY })).json()) as {
      id: string;
    };

    await expect(
      testDatabase().query('UPDATE leave_ledger_entries SET minutes = 0 WHERE id = $1', [entry.id]),
    ).rejects.toThrow();
  });

  it('積んだ記録は消せない', async () => {
    const instance = app();
    const entry = (await (await grant(instance, { minutes: 10 * DAY })).json()) as {
      id: string;
    };

    await expect(
      testDatabase().query('DELETE FROM leave_ledger_entries WHERE id = $1', [entry.id]),
    ).rejects.toThrow();
  });
});

describe('取消', () => {
  it('取り消した付与は残数から外れ、元の記録も残る', async () => {
    const instance = app();
    const entry = (await (await grant(instance, { minutes: 10 * DAY })).json()) as {
      id: string;
    };

    const reversed = await instance.request(
      `/api/leave-ledger/${entry.id}/reverse`,
      authorized(fixture.adminCookie, { method: 'POST', body: { reason: '付与の誤り' } }),
    );
    expect(reversed.status).toBe(201);

    expect(await balanceOf(instance, '2026-04-30')).toMatchObject({ availableMinutes: 0 });

    const ledger = await instance.request(
      `/api/leave-ledger?employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    // 元の付与も取消も、どちらも台帳に残る。
    expect(((await ledger.json()) as { entries: LeaveLedgerEntryRecord[] }).entries).toHaveLength(
      2,
    );
  });

  it('同じ記録は二度取り消せない', async () => {
    const instance = app();
    const entry = (await (await grant(instance, { minutes: 10 * DAY })).json()) as {
      id: string;
    };
    const body = { method: 'POST' as const, body: { reason: '付与の誤り' } };

    await instance.request(
      `/api/leave-ledger/${entry.id}/reverse`,
      authorized(fixture.adminCookie, body),
    );
    const second = await instance.request(
      `/api/leave-ledger/${entry.id}/reverse`,
      authorized(fixture.adminCookie, body),
    );

    expect(second.status).toBe(409);
  });

  it('同時に届いた取消でも、通るのは 1 つだけ', async () => {
    const instance = app();
    const entry = (await (await grant(instance, { minutes: 10 * DAY })).json()) as {
      id: string;
    };
    const send = async (): Promise<Response> =>
      instance.request(
        `/api/leave-ledger/${entry.id}/reverse`,
        authorized(fixture.adminCookie, { method: 'POST', body: { reason: '付与の誤り' } }),
      );

    const results = await Promise.all([send(), send(), send()]);

    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
  });
});

describe('手当て', () => {
  it('残数を超えて減らせない', async () => {
    const instance = app();
    await grant(instance, { minutes: 2 * DAY });

    const response = await instance.request(
      '/api/leave-ledger/adjustments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          leaveTypeId: fixture.paidLeaveId,
          minutes: -3 * DAY,
          effectiveOn: '2026-04-10',
          reason: '過大な付与の訂正',
        },
      }),
    );

    expect(response.status).toBe(409);
  });

  it('理由の無い手当ては受け付けない', async () => {
    const instance = app();
    await grant(instance, { minutes: 2 * DAY });

    const response = await instance.request(
      '/api/leave-ledger/adjustments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          leaveTypeId: fixture.paidLeaveId,
          minutes: -DAY,
          effectiveOn: '2026-04-10',
        },
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('権限', () => {
  it('従業員は付与できない', async () => {
    const response = await app().request(
      '/api/leave-ledger/grants',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          leaveTypeId: fixture.paidLeaveId,
          minutes: DAY,
          effectiveOn: '2026-04-01',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('従業員は自分の残数を見られる', async () => {
    const instance = app();
    await grant(instance, { minutes: 3 * DAY });

    const response = await instance.request(
      `/api/leave-balances?employeeId=${fixture.employeeId}&asOf=2026-04-30`,
      authorized(fixture.employeeCookie),
    );

    expect(response.status).toBe(200);
    const { balances } = (await response.json()) as { balances: LeaveBalanceRecord[] };
    expect(balances).toEqual([
      expect.objectContaining({ leaveTypeId: fixture.paidLeaveId, availableMinutes: 3 * DAY }),
    ]);
  });

  it('従業員は休暇種別の設定を変えられない', async () => {
    const response = await app().request(
      `/api/leave-type-settings/${fixture.paidLeaveId}`,
      authorized(fixture.employeeCookie, { method: 'PATCH', body: { unitMinutes: 60 } }),
    );

    expect(response.status).toBe(403);
  });
});
