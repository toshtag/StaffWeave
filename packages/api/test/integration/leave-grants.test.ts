/**
 * 休暇の自動付与・一斉付与・CSV 取込と、失効予定・休暇管理簿。
 *
 * ここで固定したいのは 4 つ。
 *
 *   規則が無ければ 1 分も付与しないこと
 *   同じ日への二重付与が起きないこと
 *   CSV は 1 行でも読めなければ何も取り込まないこと
 *   休暇を扱えない利用者が、まとめて付与できないこと
 */
import type {
  GrantLeaveInBulkResponse,
  LeaveExpirationList,
  LeaveGrantRuleList,
  LeaveRegisterList,
} from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
  type TestApp,
  testAppFactory,
} from '../support/fixtures.js';

const DAY = 8 * 60;
const app = testAppFactory({ now: '2026-10-01T00:00:00.000Z' });

interface Fixture {
  workspaceId: string;
  headquartersId: string;
  branchId: string;
  /** 2025-04-01 入社。本社。 */
  seniorId: string;
  /** 2026-01-15 入社。本社。 */
  juniorId: string;
  /** 2025-04-01 入社。支社。組織で絞ったときの相手。 */
  outsiderId: string;
  paidLeaveId: string;
  adminCookie: string;
  managerCookie: string;
}

let fixture: Fixture;

async function setUp(): Promise<Fixture> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const headquartersId = await createOrganization(db, workspaceId, { code: 'HQ' });
  const branchId = await createOrganization(db, workspaceId, { code: 'BR' });

  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const manager = await createUser(db, workspaceId, {
    email: 'manager@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, {
    userId: manager,
    organizationId: headquartersId,
  });

  const senior = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: headquartersId,
    employeeNumber: 'E001',
    displayName: '古参 花子',
    email: 'hanako@example.com',
  });
  const junior = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: headquartersId,
    employeeNumber: 'E002',
    displayName: '新人 太郎',
    email: 'taro@example.com',
  });
  const outsider = await createEmployeeWithAccount(db, workspaceId, {
    organizationId: branchId,
    employeeNumber: 'E003',
    displayName: '支社 次郎',
    email: 'jiro@example.com',
  });

  await db.query('UPDATE employees SET hired_on = $2 WHERE id = $1', [
    senior.employeeId,
    '2025-04-01',
  ]);
  await db.query('UPDATE employees SET hired_on = $2 WHERE id = $1', [
    junior.employeeId,
    '2026-01-15',
  ]);
  await db.query('UPDATE employees SET hired_on = $2 WHERE id = $1', [
    outsider.employeeId,
    '2025-04-01',
  ]);

  const leaveTypes = await db.query<{ id: string }>(
    `INSERT INTO leave_types (workspace_id, code, name, paid, unit_minutes, day_minutes,
                              expires_after_months)
     VALUES ($1, 'PAID', '年次有給', true, 60, $2, 24)
     RETURNING id`,
    [workspaceId, DAY],
  );
  const paidLeave = leaveTypes[0];
  if (!paidLeave) throw new Error('休暇種別を用意できませんでした');

  const instance = app();
  return {
    workspaceId,
    headquartersId,
    branchId,
    seniorId: senior.employeeId,
    juniorId: junior.employeeId,
    outsiderId: outsider.employeeId,
    paidLeaveId: paidLeave.id,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    managerCookie: await loginAndGetCookie(instance, { email: 'manager@example.com' }),
  };
}

beforeEach(async () => {
  fixture = await setUp();
});

async function addRule(
  instance: TestApp,
  serviceMonths: number,
  minutes: number,
): Promise<Response> {
  return instance.request(
    '/api/leave-grant-rules',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { leaveTypeId: fixture.paidLeaveId, serviceMonths, minutes },
    }),
  );
}

async function grantInBulk(
  instance: TestApp,
  body: Record<string, unknown> = {},
  cookie = fixture.adminCookie,
): Promise<Response> {
  return instance.request(
    '/api/leave-ledger/bulk-grants',
    authorized(cookie, {
      method: 'POST',
      body: {
        leaveTypeId: fixture.paidLeaveId,
        basis: 'fixed_date',
        effectiveOn: '2026-10-01',
        ...body,
      },
    }),
  );
}

async function balances(instance: TestApp, employeeId: string): Promise<number> {
  const response = await instance.request(
    `/api/leave-balances?employeeId=${employeeId}&asOf=2026-10-01`,
    authorized(fixture.adminCookie),
  );
  const { balances: rows } = (await response.json()) as {
    balances: { availableMinutes: number }[];
  };
  return rows.reduce((total, row) => total + row.availableMinutes, 0);
}

describe('付与規則', () => {
  it('段を置いて一覧できる', async () => {
    const instance = app();
    expect((await addRule(instance, 6, 10 * DAY)).status).toBe(201);
    expect((await addRule(instance, 18, 11 * DAY)).status).toBe(201);

    const response = await instance.request(
      '/api/leave-grant-rules',
      authorized(fixture.adminCookie),
    );
    const { leaveGrantRules } = (await response.json()) as LeaveGrantRuleList;

    expect(leaveGrantRules.map((rule) => rule.serviceMonths)).toEqual([6, 18]);
  });

  it('同じ勤続の段は二度置けない', async () => {
    const instance = app();
    await addRule(instance, 6, 10 * DAY);

    expect((await addRule(instance, 6, 12 * DAY)).status).toBe(409);
  });

  it('休暇を扱えない利用者は段を置けない', async () => {
    const db = testDatabase();
    await createUser(db, fixture.workspaceId, {
      email: 'plain@example.com',
      roles: ['employee'],
    });
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'plain@example.com' });

    const response = await instance.request(
      '/api/leave-grant-rules',
      authorized(cookie, {
        method: 'POST',
        body: { leaveTypeId: fixture.paidLeaveId, serviceMonths: 6, minutes: DAY },
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe('一斉付与', () => {
  it('規則が無ければ、1 分も付与しない', async () => {
    const instance = app();

    const response = await grantInBulk(instance);
    const result = (await response.json()) as GrantLeaveInBulkResponse;

    expect(response.status).toBe(200);
    expect(result.granted).toEqual([]);
    expect(result.skipped.every((entry) => entry.reason === 'no_rule_reached')).toBe(true);
    expect(await balances(instance, fixture.seniorId)).toBe(0);
  });

  it('勤続に応じた段で、まとめて付与する', async () => {
    const instance = app();
    await addRule(instance, 6, 10 * DAY);
    await addRule(instance, 18, 11 * DAY);

    const result = (await (await grantInBulk(instance)).json()) as GrantLeaveInBulkResponse;

    // 2025-04-01 入社は勤続 18 か月、2026-01-15 入社は勤続 8 か月。
    expect(result.granted).toEqual(
      expect.arrayContaining([
        { employeeId: fixture.seniorId, minutes: 11 * DAY, serviceMonths: 18 },
        { employeeId: fixture.juniorId, minutes: 10 * DAY, serviceMonths: 8 },
      ]),
    );
    expect(await balances(instance, fixture.seniorId)).toBe(11 * DAY);
  });

  it('同じ日に二度実行しても、二重に付与しない', async () => {
    const instance = app();
    await addRule(instance, 6, 10 * DAY);

    await grantInBulk(instance);
    const second = (await (await grantInBulk(instance)).json()) as GrantLeaveInBulkResponse;

    expect(second.granted).toEqual([]);
    expect(second.skipped.some((entry) => entry.reason === 'already_granted')).toBe(true);
    expect(await balances(instance, fixture.seniorId)).toBe(10 * DAY);
  });

  it('入社日基準では、その日が記念日の人だけへ付与する', async () => {
    const instance = app();
    await addRule(instance, 6, 10 * DAY);

    const result = (await (
      await grantInBulk(instance, { basis: 'hire_anniversary', effectiveOn: '2026-04-01' })
    ).json()) as GrantLeaveInBulkResponse;

    // 支社の従業員も 2025-04-01 入社なので、同じ記念日に当たる。
    expect(result.granted.map((entry) => entry.employeeId).sort()).toEqual(
      [fixture.seniorId, fixture.outsiderId].sort(),
    );
    expect(result.skipped).toContainEqual({
      employeeId: fixture.juniorId,
      reason: 'not_anniversary',
    });
  });

  it('休暇を扱えない利用者は、まとめて付与できない', async () => {
    const instance = app();
    await addRule(instance, 6, 10 * DAY);

    const response = await grantInBulk(instance, {}, fixture.managerCookie);

    expect(response.status).toBe(403);
    expect(await balances(instance, fixture.seniorId)).toBe(0);
  });

  it('組織で対象を絞れる', async () => {
    const instance = app();
    await addRule(instance, 6, 10 * DAY);

    const result = (await (
      await grantInBulk(instance, { organizationId: fixture.branchId })
    ).json()) as GrantLeaveInBulkResponse;

    expect(result.granted.map((entry) => entry.employeeId)).toEqual([fixture.outsiderId]);
  });
});

describe('CSV の取込', () => {
  const header = 'employee_number,leave_type_code,minutes,effective_on\n';

  async function importCsv(instance: TestApp, body: string): Promise<Response> {
    return instance.request('/api/leave-ledger/imports', {
      method: 'POST',
      headers: { cookie: fixture.adminCookie, 'content-type': 'text/csv' },
      body,
    });
  }

  it('行を取り込み、失効日は休暇種別の設定から決まる', async () => {
    const instance = app();

    const response = await importCsv(instance, `${header}E001,PAID,480,2026-10-01\n`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 1 });

    const ledger = await instance.request(
      `/api/leave-ledger?employeeId=${fixture.seniorId}`,
      authorized(fixture.adminCookie),
    );
    const { entries } = (await ledger.json()) as {
      entries: { minutes: number; expiresOn: string | null }[];
    };
    // 24 か月後。
    expect(entries[0]).toMatchObject({ minutes: 480, expiresOn: '2028-10-01' });
  });

  it('1 行でも読めなければ、何も取り込まない', async () => {
    const instance = app();

    const response = await importCsv(
      instance,
      `${header}E001,PAID,480,2026-10-01\nE999,PAID,480,2026-10-01\n`,
    );

    expect(response.status).toBe(400);
    // 良い行も入っていない。
    expect(await balances(instance, fixture.seniorId)).toBe(0);
  });

  it('見出しが足りなければ断る', async () => {
    const instance = app();

    const response = await importCsv(instance, 'employee_number,minutes\nE001,480\n');

    expect(response.status).toBe(400);
  });

  it('同じ日への二度目の取込は断る', async () => {
    const instance = app();
    await importCsv(instance, `${header}E001,PAID,480,2026-10-01\n`);

    const second = await importCsv(instance, `${header}E001,PAID,480,2026-10-01\n`);

    expect(second.status).toBe(409);
    expect(await balances(instance, fixture.seniorId)).toBe(480);
  });

  it('休暇を扱えない利用者は取り込めない', async () => {
    const instance = app();

    const response = await instance.request('/api/leave-ledger/imports', {
      method: 'POST',
      headers: { cookie: fixture.managerCookie, 'content-type': 'text/csv' },
      body: `${header}E003,PAID,480,2026-10-01\n`,
    });

    expect(response.status).toBe(403);
    expect(await balances(instance, fixture.outsiderId)).toBe(0);
  });
});

describe('失効予定', () => {
  it('その日までに失効する付与を、残りつきで出す', async () => {
    const instance = app();
    await instance.request(
      '/api/leave-ledger/grants',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.seniorId,
          leaveTypeId: fixture.paidLeaveId,
          minutes: 5 * DAY,
          effectiveOn: '2026-04-01',
          expiresOn: '2026-12-31',
        },
      }),
    );

    const response = await instance.request(
      `/api/leave-expirations?asOf=2026-10-01&through=2026-12-31&employeeId=${fixture.seniorId}`,
      authorized(fixture.adminCookie),
    );
    const { expirations } = (await response.json()) as LeaveExpirationList;

    expect(expirations).toHaveLength(1);
    expect(expirations[0]).toMatchObject({
      employeeNumber: 'E001',
      expiresOn: '2026-12-31',
      remainingMinutes: 5 * DAY,
    });
  });

  it('先の失効は、指定した日までに入らなければ出さない', async () => {
    const instance = app();
    await instance.request(
      '/api/leave-ledger/grants',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.seniorId,
          leaveTypeId: fixture.paidLeaveId,
          minutes: 5 * DAY,
          effectiveOn: '2026-04-01',
          expiresOn: '2027-12-31',
        },
      }),
    );

    const response = await instance.request(
      `/api/leave-expirations?asOf=2026-10-01&through=2026-12-31&employeeId=${fixture.seniorId}`,
      authorized(fixture.adminCookie),
    );
    const { expirations } = (await response.json()) as LeaveExpirationList;

    expect(expirations).toEqual([]);
  });
});

describe('休暇管理簿', () => {
  it('期首・付与・消化・期末を、台帳から組み立てて出す', async () => {
    const instance = app();
    for (const [effectiveOn, minutes] of [
      ['2025-04-01', 10 * DAY],
      ['2026-04-01', 11 * DAY],
    ] as const) {
      await instance.request(
        '/api/leave-ledger/grants',
        authorized(fixture.adminCookie, {
          method: 'POST',
          body: {
            employeeId: fixture.seniorId,
            leaveTypeId: fixture.paidLeaveId,
            minutes,
            effectiveOn,
          },
        }),
      );
    }
    await instance.request(
      '/api/leave-ledger/adjustments',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.seniorId,
          leaveTypeId: fixture.paidLeaveId,
          minutes: -2 * DAY,
          effectiveOn: '2026-05-10',
          reason: '取得の記録',
        },
      }),
    );

    const response = await instance.request(
      `/api/leave-register?from=2026-04-01&to=2027-03-31&employeeId=${fixture.seniorId}`,
      authorized(fixture.adminCookie),
    );
    const { register } = (await response.json()) as LeaveRegisterList;

    expect(register).toHaveLength(1);
    expect(register[0]).toMatchObject({
      employeeNumber: 'E001',
      openingMinutes: 10 * DAY,
      grantedMinutes: 11 * DAY,
      adjustedMinutes: -2 * DAY,
      closingMinutes: 19 * DAY,
    });
  });

  it('従業員は他人の管理簿を読めない', async () => {
    const db = testDatabase();
    await createUser(db, fixture.workspaceId, {
      email: 'plain@example.com',
      roles: ['employee'],
    });
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'plain@example.com' });

    const response = await instance.request(
      `/api/leave-register?from=2026-04-01&to=2027-03-31&employeeId=${fixture.seniorId}`,
      authorized(cookie),
    );

    expect(response.status).toBe(403);
  });
});

describe('自動付与の定期実行', () => {
  /** 自動付与を有効にする。基準を置いただけでは動かない。 */
  async function enableAutoGrant(
    instance: TestApp,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return instance.request(
      `/api/leave-type-settings/${fixture.paidLeaveId}`,
      authorized(fixture.adminCookie, { method: 'PATCH', body }),
    );
  }

  async function runNow(instance: TestApp, cookie = fixture.adminCookie): Promise<Response> {
    return instance.request('/api/leave-grant-runs', authorized(cookie, { method: 'POST' }));
  }

  async function runs(
    instance: TestApp,
  ): Promise<{ effectiveOn: string; grantedCount: number; skippedCount: number }[]> {
    const response = await instance.request(
      `/api/leave-grant-runs?leaveTypeId=${fixture.paidLeaveId}`,
      authorized(fixture.adminCookie),
    );
    const { runs: rows } = (await response.json()) as {
      runs: { effectiveOn: string; grantedCount: number; skippedCount: number }[];
    };
    return rows;
  }

  async function availableMinutes(instance: TestApp, employeeId: string): Promise<number> {
    const response = await instance.request(
      `/api/leave-balances?employeeId=${employeeId}&asOf=2026-10-01`,
      authorized(fixture.adminCookie),
    );
    const { balances } = (await response.json()) as {
      balances: { leaveTypeId: string; availableMinutes: number }[];
    };
    return (
      balances.find((balance) => balance.leaveTypeId === fixture.paidLeaveId)?.availableMinutes ?? 0
    );
  }

  it('有効にしていなければ、動かしても何も起きない', async () => {
    const instance = app();
    expect((await addRule(instance, 6, 10 * DAY)).status).toBe(201);
    // 基準だけを置く。有効にはしない。
    expect((await enableAutoGrant(instance, { grantBasis: 'hire_anniversary' })).status).toBe(200);

    expect((await runNow(instance)).status).toBe(200);
    expect(await runs(instance)).toEqual([]);
    expect(await availableMinutes(instance, fixture.seniorId)).toBe(0);
  });

  /**
   * 止まっていた期間を追いつく。
   *
   * 開始日を過去へ置いて動かすと、その日から今日までの日を古い順に処理する。
   * 入社日基準では、その日が記念日の人だけが対象になる。
   */
  it('開始日から今日までを追いつき、記念日の人へ付与する', async () => {
    const instance = app();
    expect((await addRule(instance, 6, 10 * DAY)).status).toBe(201);
    expect(
      (
        await enableAutoGrant(instance, {
          grantBasis: 'hire_anniversary',
          autoGrantEnabled: true,
          autoGrantFrom: '2026-09-25',
        })
      ).status,
    ).toBe(200);

    expect((await runNow(instance)).status).toBe(200);

    // 2026-09-25 から 2026-10-01 の 7 日ぶんを処理する。
    const processed = await runs(instance);
    expect(processed.map((run) => run.effectiveOn).sort()).toEqual([
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);

    // 2025-04-01 入社の相手は、この期間に記念日が来ない。
    expect(await availableMinutes(instance, fixture.seniorId)).toBe(0);
  });

  it('二度動かしても、同じ日を二度付与しない', async () => {
    const instance = app();
    expect((await addRule(instance, 6, 10 * DAY)).status).toBe(201);
    expect(
      (
        await enableAutoGrant(instance, {
          grantBasis: 'fixed_date',
          autoGrantEnabled: true,
          autoGrantFrom: '2026-09-01',
          grantFixedMonth: 9,
          grantFixedDay: 15,
        })
      ).status,
    ).toBe(200);

    await runNow(instance);
    const first = await availableMinutes(instance, fixture.seniorId);
    expect(first).toBe(10 * DAY);

    await runNow(instance);
    expect(await availableMinutes(instance, fixture.seniorId)).toBe(first);
    // 処理した日は 1 件のまま。二度目は追いつく日が無い。
    expect(await runs(instance)).toHaveLength(1);
  });

  it('対象が誰も居なかった日も記録し、次から飛ばす', async () => {
    const instance = app();
    // 規則を置かない。誰も付与の段に達しない。
    expect(
      (
        await enableAutoGrant(instance, {
          grantBasis: 'fixed_date',
          autoGrantEnabled: true,
          autoGrantFrom: '2026-09-01',
          grantFixedMonth: 9,
          grantFixedDay: 15,
        })
      ).status,
    ).toBe(200);

    await runNow(instance);
    const processed = await runs(instance);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({ effectiveOn: '2026-09-15', grantedCount: 0 });
    // 記録が残らないと、対象の居ない日を毎回やり直すことになり追いつきが進まない。
    expect(processed[0]?.skippedCount).toBeGreaterThan(0);
  });

  it('次に対象となる日と人数を、動かさずに見られる', async () => {
    const instance = app();
    expect((await addRule(instance, 6, 10 * DAY)).status).toBe(201);
    expect(
      (
        await enableAutoGrant(instance, {
          grantBasis: 'fixed_date',
          autoGrantEnabled: true,
          autoGrantFrom: '2026-09-01',
          grantFixedMonth: 9,
          grantFixedDay: 15,
        })
      ).status,
    ).toBe(200);

    const response = await instance.request(
      `/api/leave-grant-runs/preview?leaveTypeId=${fixture.paidLeaveId}`,
      authorized(fixture.adminCookie),
    );
    const preview = (await response.json()) as {
      effectiveOn: string | null;
      grantedCount: number;
    };

    expect(preview.effectiveOn).toBe('2026-09-15');
    expect(preview.grantedCount).toBeGreaterThan(0);
    // 見ただけでは積まない。
    expect(await availableMinutes(instance, fixture.seniorId)).toBe(0);
    expect(await runs(instance)).toEqual([]);
  });

  it('休暇を扱えない利用者は動かせない', async () => {
    const instance = app();
    expect((await runNow(instance, fixture.managerCookie)).status).toBe(403);
  });

  it('止めた休暇種別へは自動付与しない', async () => {
    const instance = app();
    expect((await addRule(instance, 6, 10 * DAY)).status).toBe(201);
    expect(
      (
        await enableAutoGrant(instance, {
          grantBasis: 'fixed_date',
          autoGrantEnabled: true,
          autoGrantFrom: '2026-09-01',
          grantFixedMonth: 9,
          grantFixedDay: 15,
          active: false,
        })
      ).status,
    ).toBe(200);

    await runNow(instance);

    expect(await runs(instance)).toEqual([]);
    expect(await availableMinutes(instance, fixture.seniorId)).toBe(0);
  });
});
