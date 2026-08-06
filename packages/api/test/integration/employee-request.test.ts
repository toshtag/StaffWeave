/**
 * 申請種別と段階承認。
 *
 * ここで固定したいのは 3 つ。
 *
 *   承認の途中で定義を変えても、進行中の申請の経路が変わらないこと
 *   同じ決裁を送り直しても、段が進まないこと
 *   休暇の申請は、承認しきったときにだけ台帳へ反映され、二度反映されないこと
 */
import type {
  EmployeeRequestRecord,
  LeaveBalanceRecord,
  RequestTypeRecord,
} from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createTestApp,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

interface Fixture {
  adminCookie: string;
  managerCookie: string;
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
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const manager = await createUser(db, workspaceId, {
    email: 'manager@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: manager, organizationId });

  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '申請 花子',
    email: 'hanako@example.com',
  });

  const leaveTypes = await db.query<{ id: string }>(
    `INSERT INTO leave_types (workspace_id, code, name, paid, unit_minutes, day_minutes)
     VALUES ($1, 'PAID', '年次有給', true, 60, $2)
     RETURNING id`,
    [workspaceId, DAY],
  );
  const paidLeave = leaveTypes[0];
  if (!paidLeave) throw new Error('休暇種別を用意できませんでした');

  const instance = app();
  return {
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    managerCookie: await loginAndGetCookie(instance, { email: 'manager@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    employeeId: employee.employeeId,
    paidLeaveId: paidLeave.id,
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setUp();
});

async function createType(
  instance: TestApp,
  body: Record<string, unknown>,
): Promise<RequestTypeRecord> {
  const response = await instance.request(
    '/api/request-types',
    authorized(fixture.adminCookie, {
      method: 'POST',
      body: { code: 'OT', name: '残業', category: 'overtime', approvalSteps: 1, ...body },
    }),
  );
  if (response.status !== 201) throw new Error(`申請種別を作れませんでした: ${response.status}`);
  return (await response.json()) as RequestTypeRecord;
}

async function submit(
  instance: TestApp,
  type: RequestTypeRecord,
  body: Record<string, unknown> = {},
): Promise<EmployeeRequestRecord> {
  const response = await instance.request(
    '/api/employee-requests',
    authorized(fixture.employeeCookie, {
      method: 'POST',
      body: {
        requestTypeId: type.id,
        employeeId: fixture.employeeId,
        businessDate: '2026-04-10',
        reason: '対応のため',
        ...body,
      },
    }),
  );
  if (response.status !== 201) throw new Error(`申請できませんでした: ${response.status}`);
  return (await response.json()) as EmployeeRequestRecord;
}

async function decide(
  instance: TestApp,
  requestId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return instance.request(
    `/api/employee-requests/${requestId}/decisions`,
    authorized(fixture.adminCookie, { method: 'POST', body }),
  );
}

describe('段階承認', () => {
  it('段を順に進めて承認しきる', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 3 });
    const request = await submit(instance, type);

    expect(request).toMatchObject({ state: 'submitted', totalSteps: 3, currentStep: 1 });

    for (const step of [1, 2, 3]) {
      const response = await decide(instance, request.id, {
        decision: 'approved',
        step,
        submission: 1,
      });
      expect(response.status).toBe(200);
      const decided = (await response.json()) as EmployeeRequestRecord;
      expect(decided.state).toBe(step === 3 ? 'approved' : 'submitted');
    }
  });

  it('同じ段の承認を送り直しても、次の段へ進まない', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 3 });
    const request = await submit(instance, type);

    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });
    const replay = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
    });

    expect(replay.status).toBe(409);

    const listed = await instance.request(
      `/api/employee-requests?employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    const { requests } = (await listed.json()) as { requests: EmployeeRequestRecord[] };
    expect(requests[0]).toMatchObject({ currentStep: 2, state: 'submitted' });
  });

  it('同時に届いた同じ段の承認でも、通るのは 1 つだけ', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 3 });
    const request = await submit(instance, type);

    const results = await Promise.all([
      decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 }),
      decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 }),
      decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 }),
    ]);

    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
  });

  it('先の段を飛ばして承認できない', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 3 });
    const request = await submit(instance, type);

    const skipped = await decide(instance, request.id, {
      decision: 'approved',
      step: 3,
      submission: 1,
    });

    expect(skipped.status).toBe(409);
  });

  it('代理の承認では、本来の承認者も記録に残る', async () => {
    const instance = app();
    const type = await createType(instance, {});
    const request = await submit(instance, type);
    const users = await testDatabase().query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      ['manager@example.com'],
    );
    const manager = users[0];
    if (!manager) throw new Error('承認者が見つかりません');

    const response = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
      onBehalfOfUserId: manager.id,
    });

    expect(response.status).toBe(200);
    const decided = (await response.json()) as EmployeeRequestRecord;
    expect(decided.approvals).toEqual([
      expect.objectContaining({ step: 1, submission: 1, onBehalfOfUserId: manager.id }),
    ]);
  });
});

describe('承認中の定義変更', () => {
  it('段数を減らしても、進行中の申請の段は消えない', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 3 });
    const request = await submit(instance, type);
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    const updated = await instance.request(
      `/api/request-types/${type.id}`,
      authorized(fixture.adminCookie, { method: 'PATCH', body: { approvalSteps: 1 } }),
    );
    expect(updated.status).toBe(200);

    // 定義は 1 段になったが、この申請は出したときの 3 段のまま。
    const second = await decide(instance, request.id, {
      decision: 'approved',
      step: 2,
      submission: 1,
    });
    expect(((await second.json()) as EmployeeRequestRecord).state).toBe('submitted');

    const third = await decide(instance, request.id, {
      decision: 'approved',
      step: 3,
      submission: 1,
    });
    expect(((await third.json()) as EmployeeRequestRecord).state).toBe('approved');
  });

  it('段数を増やしても、進行中の申請は出したときの段数で終わる', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 1 });
    const request = await submit(instance, type);

    await instance.request(
      `/api/request-types/${type.id}`,
      authorized(fixture.adminCookie, { method: 'PATCH', body: { approvalSteps: 4 } }),
    );

    const response = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
    });
    expect(((await response.json()) as EmployeeRequestRecord).state).toBe('approved');
  });

  it('使えなくした申請種別では、新しい申請を出せない', async () => {
    const instance = app();
    const type = await createType(instance, {});
    await instance.request(
      `/api/request-types/${type.id}`,
      authorized(fixture.adminCookie, { method: 'PATCH', body: { active: false } }),
    );

    const response = await instance.request(
      '/api/employee-requests',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          requestTypeId: type.id,
          employeeId: fixture.employeeId,
          businessDate: '2026-04-10',
          reason: '対応のため',
        },
      }),
    );

    expect(response.status).toBe(409);
  });
});

describe('差し戻しと出し直し', () => {
  it('差し戻したあとに出し直すと、1 段目からやり直す', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 2 });
    const request = await submit(instance, type);
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });
    await decide(instance, request.id, {
      decision: 'returned',
      step: 2,
      submission: 1,
      comment: '内容を直してください',
    });

    const resubmitted = await instance.request(
      `/api/employee-requests/${request.id}/resubmissions`,
      authorized(fixture.employeeCookie, { method: 'POST', body: { reason: '直しました' } }),
    );

    expect(resubmitted.status).toBe(200);
    expect((await resubmitted.json()) as EmployeeRequestRecord).toMatchObject({
      state: 'submitted',
      currentStep: 1,
      submissions: 2,
    });
  });

  it('前の提出に宛てた承認は、出し直したあとの申請へ効かない', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 2 });
    const request = await submit(instance, type);
    await decide(instance, request.id, {
      decision: 'returned',
      step: 1,
      submission: 1,
      comment: '直してください',
    });
    await instance.request(
      `/api/employee-requests/${request.id}/resubmissions`,
      authorized(fixture.employeeCookie, { method: 'POST', body: {} }),
    );

    const stale = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 1,
    });

    expect(stale.status).toBe(409);
  });

  it('前の提出の決裁も台帳に残る', async () => {
    const instance = app();
    const type = await createType(instance, { approvalSteps: 2 });
    const request = await submit(instance, type);
    await decide(instance, request.id, {
      decision: 'returned',
      step: 1,
      submission: 1,
      comment: '直してください',
    });
    await instance.request(
      `/api/employee-requests/${request.id}/resubmissions`,
      authorized(fixture.employeeCookie, { method: 'POST', body: {} }),
    );
    const response = await decide(instance, request.id, {
      decision: 'approved',
      step: 1,
      submission: 2,
    });

    const decided = (await response.json()) as EmployeeRequestRecord;
    expect(decided.approvals).toHaveLength(2);
  });

  it('理由の無い差し戻しは受け付けない', async () => {
    const instance = app();
    const type = await createType(instance, {});
    const request = await submit(instance, type);

    const response = await decide(instance, request.id, {
      decision: 'returned',
      step: 1,
      submission: 1,
    });

    expect(response.status).toBe(400);
  });
});

describe('休暇の申請と台帳', () => {
  async function leaveType(instance: TestApp): Promise<RequestTypeRecord> {
    return createType(instance, {
      code: 'LEAVE',
      name: '年次有給',
      category: 'leave',
      requiresLeaveType: true,
      approvalSteps: 2,
    });
  }

  async function grant(instance: TestApp, minutes: number): Promise<void> {
    const response = await instance.request(
      '/api/leave-ledger/grants',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: {
          employeeId: fixture.employeeId,
          leaveTypeId: fixture.paidLeaveId,
          minutes,
          effectiveOn: '2026-04-01',
        },
      }),
    );
    if (response.status !== 201) throw new Error(`付与できませんでした: ${response.status}`);
  }

  async function availableMinutes(instance: TestApp): Promise<number | undefined> {
    const response = await instance.request(
      `/api/leave-balances?employeeId=${fixture.employeeId}&asOf=2026-04-30`,
      authorized(fixture.adminCookie),
    );
    const { balances } = (await response.json()) as { balances: LeaveBalanceRecord[] };
    return balances.find((balance) => balance.leaveTypeId === fixture.paidLeaveId)
      ?.availableMinutes;
  }

  it('承認しきったときにだけ台帳へ反映する', async () => {
    const instance = app();
    await grant(instance, 10 * DAY);
    const type = await leaveType(instance);
    const request = await submit(instance, type, { leaveTypeId: fixture.paidLeaveId });

    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });
    // 1 段目では、まだ引かない。
    expect(await availableMinutes(instance)).toBe(10 * DAY);

    await decide(instance, request.id, { decision: 'approved', step: 2, submission: 1 });
    expect(await availableMinutes(instance)).toBe(9 * DAY);
  });

  it('休暇種別の入力を求める申請では、選ばないと出せない', async () => {
    const instance = app();
    const type = await leaveType(instance);

    const response = await instance.request(
      '/api/employee-requests',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          requestTypeId: type.id,
          employeeId: fixture.employeeId,
          businessDate: '2026-04-10',
          reason: '私用のため',
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('残数が足りなければ承認できない', async () => {
    const instance = app();
    await grant(instance, 4 * 60);
    const type = await leaveType(instance);
    const request = await submit(instance, type, { leaveTypeId: fixture.paidLeaveId });

    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });
    const final = await decide(instance, request.id, {
      decision: 'approved',
      step: 2,
      submission: 1,
    });

    expect(final.status).toBe(409);
    // 承認が通らなかったのだから、残数も動いていない。
    expect(await availableMinutes(instance)).toBe(4 * 60);
  });

  it('同時に承認された別々の申請でも、残数は負にならない', async () => {
    const instance = app();
    // 1 日ぶんしか無いところへ、1 日ずつの申請を 2 件出す。
    await grant(instance, DAY);
    const type = await leaveType(instance);
    const first = await submit(instance, type, { leaveTypeId: fixture.paidLeaveId });
    const second = await submit(instance, type, {
      leaveTypeId: fixture.paidLeaveId,
      businessDate: '2026-04-11',
    });
    for (const request of [first, second]) {
      await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });
    }

    const results = await Promise.all([
      decide(instance, first.id, { decision: 'approved', step: 2, submission: 1 }),
      decide(instance, second.id, { decision: 'approved', step: 2, submission: 1 }),
    ]);

    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await availableMinutes(instance)).toBe(0);
  });

  it('取得の単位に合わない時間帯は承認できない', async () => {
    const instance = app();
    await grant(instance, 10 * DAY);
    const type = await leaveType(instance);
    const request = await submit(instance, type, {
      leaveTypeId: fixture.paidLeaveId,
      // 単位は 60 分。90 分は倍数にならない。
      startMinutes: 9 * 60,
      endMinutes: 10 * 60 + 30,
    });

    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });
    const final = await decide(instance, request.id, {
      decision: 'approved',
      step: 2,
      submission: 1,
    });

    expect(final.status).toBe(409);
  });
});

describe('権限', () => {
  it('自分の申請は自分で承認できない', async () => {
    const instance = app();
    const type = await createType(instance, {});
    const request = await submit(instance, type);

    const response = await instance.request(
      `/api/employee-requests/${request.id}/decisions`,
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { decision: 'approved', step: 1, submission: 1 },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('従業員の一覧には、自分の申請しか出ない', async () => {
    const instance = app();
    const type = await createType(instance, {});
    await submit(instance, type);

    const db = testDatabase();
    const workspaces = await db.query<{ id: string }>('SELECT id FROM workspaces LIMIT 1');
    const workspaceId = workspaces[0]?.id;
    if (!workspaceId) throw new Error('ワークスペースが見つかりません');
    const organizations = await db.query<{ id: string }>('SELECT id FROM organizations LIMIT 1');
    const organizationId = organizations[0]?.id;
    if (!organizationId) throw new Error('組織が見つかりません');
    const other = await createEmployeeWithAccount(db, workspaceId, {
      organizationId,
      employeeNumber: 'E002',
      displayName: '申請 太郎',
      email: 'taro@example.com',
    });
    await db.query(
      `INSERT INTO employee_requests
         (workspace_id, request_type_id, employee_id, total_steps, business_date, reason)
       VALUES ($1, $2, $3, 1, '2026-04-10', '対応のため')`,
      [workspaceId, type.id, other.employeeId],
    );

    const response = await instance.request(
      '/api/employee-requests',
      authorized(fixture.employeeCookie),
    );

    const { requests } = (await response.json()) as { requests: EmployeeRequestRecord[] };
    expect(requests.map((request) => request.employeeId)).toEqual([fixture.employeeId]);
  });

  it('従業員は申請種別を作れない', async () => {
    const response = await app().request(
      '/api/request-types',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { code: 'X', name: 'なにか', category: 'other', approvalSteps: 1 },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('組織管理者は申請種別を作れないが、承認はできる', async () => {
    const instance = app();
    const type = await createType(instance, {});
    const request = await submit(instance, type);

    const created = await instance.request(
      '/api/request-types',
      authorized(fixture.managerCookie, {
        method: 'POST',
        body: { code: 'X', name: 'なにか', category: 'other', approvalSteps: 1 },
      }),
    );
    expect(created.status).toBe(403);

    const decided = await instance.request(
      `/api/employee-requests/${request.id}/decisions`,
      authorized(fixture.managerCookie, {
        method: 'POST',
        body: { decision: 'approved', step: 1, submission: 1 },
      }),
    );
    expect(decided.status).toBe(200);
  });

  it('取り下げられるのは本人だけ', async () => {
    const instance = app();
    const type = await createType(instance, {});
    const request = await submit(instance, type);

    const byAdmin = await instance.request(
      `/api/employee-requests/${request.id}/cancellation`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );
    expect(byAdmin.status).toBe(403);

    const byOwner = await instance.request(
      `/api/employee-requests/${request.id}/cancellation`,
      authorized(fixture.employeeCookie, { method: 'POST' }),
    );
    expect(byOwner.status).toBe(200);
    expect(((await byOwner.json()) as EmployeeRequestRecord).state).toBe('cancelled');
  });
});

describe('決裁の記録', () => {
  it('決裁は書き換えられない', async () => {
    const instance = app();
    const type = await createType(instance, {});
    const request = await submit(instance, type);
    await decide(instance, request.id, { decision: 'approved', step: 1, submission: 1 });

    await expect(
      testDatabase().query(
        `UPDATE employee_request_approvals SET decision = 'returned' WHERE request_id = $1`,
        [request.id],
      ),
    ).rejects.toThrow();
  });
});
