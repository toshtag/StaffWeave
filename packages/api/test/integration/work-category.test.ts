/**
 * 勤務区分と計算規則の版、労働形態の割当。
 *
 * 労務計算の値は事業者が決める。製品は既定値を持たない。
 * 設定しないまま計算が進むと、誰も決めていない値が結果として残る。
 * ここでは「設定できること」と「設定していなければ計算しないこと」を固定する。
 */
import type {
  CalculationRuleVersionRecord,
  LaborSystemAssignmentRecord,
  WorkCategoryRecord,
  WorkDay,
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
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

interface Fixture {
  adminCookie: string;
  employeeCookie: string;
  employeeId: string;
}

const app = (): TestApp => createTestApp();

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const employee = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  return {
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    employeeId: employee.employeeId,
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setUp();
});

async function createCategory(instance: TestApp, body: Record<string, unknown>): Promise<Response> {
  return instance.request(
    '/api/work-categories',
    authorized(fixture.adminCookie, { method: 'POST', body }),
  );
}

const baseCategory = {
  code: 'DAY',
  internalName: '通常勤務',
  displayName: '日勤',
  categoryType: 'working_day',
  effectiveFrom: '2026-04-01',
};

describe('勤務区分', () => {
  it('版を作って一覧できる', async () => {
    const instance = app();
    const response = await createCategory(instance, {
      ...baseCategory,
      scheduledStartMinutes: 9 * 60,
      scheduledEndMinutes: 18 * 60,
      prescribedMinutes: 8 * 60,
      fixedBreaks: [{ startMinutes: 12 * 60, endMinutes: 13 * 60 }],
      autoBreaks: [{ thresholdMinutes: 6 * 60, additionalMinutes: 45 }],
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as WorkCategoryRecord;
    expect(created.fixedBreaks).toEqual([{ startMinutes: 720, endMinutes: 780 }]);
    expect(created.autoBreaks).toEqual([{ thresholdMinutes: 360, additionalMinutes: 45 }]);

    const listed = await instance.request('/api/work-categories', authorized(fixture.adminCookie));
    expect(
      ((await listed.json()) as { workCategories: WorkCategoryRecord[] }).workCategories,
    ).toHaveLength(1);
  });

  it('同じ code で期間が重なる版は作れない', async () => {
    const instance = app();
    await createCategory(instance, { ...baseCategory, effectiveFrom: '2026-04-01' });

    const overlapping = await createCategory(instance, {
      ...baseCategory,
      effectiveFrom: '2026-05-01',
    });

    expect(overlapping.status).toBe(409);
  });

  it('前の版へ終了日があれば、次の版を作れる', async () => {
    const instance = app();
    await createCategory(instance, {
      ...baseCategory,
      effectiveFrom: '2026-04-01',
      effectiveTo: '2026-04-30',
    });

    const next = await createCategory(instance, { ...baseCategory, effectiveFrom: '2026-05-01' });

    expect(next.status).toBe(201);
  });

  it('固定休憩の時間帯が重なる版は作れない', async () => {
    const response = await createCategory(app(), {
      ...baseCategory,
      fixedBreaks: [
        { startMinutes: 12 * 60, endMinutes: 13 * 60 },
        { startMinutes: 12 * 60 + 30, endMinutes: 13 * 60 + 30 },
      ],
    });

    expect(response.status).toBe(409);
  });

  it('所定の開始と終了は両方そろっていなければ受け付けない', async () => {
    const response = await createCategory(app(), {
      ...baseCategory,
      scheduledStartMinutes: 9 * 60,
    });

    expect(response.status).toBe(400);
  });

  it('従業員は勤務区分を作れない', async () => {
    const response = await app().request(
      '/api/work-categories',
      authorized(fixture.employeeCookie, { method: 'POST', body: baseCategory }),
    );

    expect(response.status).toBe(403);
  });
});

describe('計算規則の版', () => {
  const baseRule = {
    effectiveFrom: '2026-04-01',
    dayStartMinutes: 0,
    nightStartMinutes: 22 * 60,
    nightEndMinutes: 5 * 60,
    roundingMinutes: 0,
    roundingMode: 'none',
    weekStartsOn: 1,
    monthStartsOn: 1,
  };

  it('閾値を設定しないままでも版を作れる', async () => {
    // 決まっていない値を無理に入れさせない。未設定のまま置ける。
    const response = await app().request(
      '/api/calculation-rule-versions',
      authorized(fixture.adminCookie, { method: 'POST', body: baseRule }),
    );

    expect(response.status).toBe(201);
    expect((await response.json()) as CalculationRuleVersionRecord).toMatchObject({
      dailyLegalMinutes: null,
    });
  });

  it('同じ適用開始日の版は 1 つだけ', async () => {
    const instance = app();
    await instance.request(
      '/api/calculation-rule-versions',
      authorized(fixture.adminCookie, { method: 'POST', body: baseRule }),
    );

    const duplicated = await instance.request(
      '/api/calculation-rule-versions',
      authorized(fixture.adminCookie, { method: 'POST', body: baseRule }),
    );

    expect(duplicated.status).toBe(409);
  });

  /**
   * 閾値を設定するまで、法定の区分は計算しない。
   * 0 を返すと「計算した結果 0 分だった」と読め、設定し忘れに気付けない。
   */
  it('閾値が未設定の間は、法定の区分を計算せず未設定として示す', async () => {
    const instance = app();
    await instance.request(
      '/api/attendance/events',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { eventType: 'clock_in', requestId: 'legal-in' },
      }),
    );
    await instance.request(
      '/api/attendance/events',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: { eventType: 'clock_out', requestId: 'legal-out' },
      }),
    );

    const response = await instance.request(
      '/api/attendance/today',
      authorized(fixture.employeeCookie),
    );
    const day = (await response.json()) as WorkDay;

    expect(day.calculation?.legalOvertimeMinutes).toBeNull();
    expect(day.calculation?.basis.unconfigured).toContain('法定内・法定外の 1 日の閾値');
  });
});

describe('労働形態の割当', () => {
  async function assign(instance: TestApp, body: Record<string, unknown>): Promise<Response> {
    return instance.request(
      '/api/labor-system-assignments',
      authorized(fixture.adminCookie, { method: 'POST', body }),
    );
  }

  it('通常勤務は追加の設定なしで割り当てられる', async () => {
    const response = await assign(app(), {
      employeeId: fixture.employeeId,
      systemType: 'normal',
      effectiveFrom: '2026-04-01',
    });

    expect(response.status).toBe(201);
  });

  it('フレックスは清算期間の設定がそろっていなければ受け付けない', async () => {
    const response = await assign(app(), {
      employeeId: fixture.employeeId,
      systemType: 'flex',
      effectiveFrom: '2026-04-01',
      settlementMonths: 1,
    });

    expect(response.status).toBe(409);
  });

  it('フレックスは設定がそろえば割り当てられる', async () => {
    const response = await assign(app(), {
      employeeId: fixture.employeeId,
      systemType: 'flex',
      effectiveFrom: '2026-04-01',
      settlementMonths: 3,
      settlementStartsOn: '2026-04-01',
      settlementBasis: 'legal',
      settlementTotalMinutes: 3 * 160 * 60,
      coreStartMinutes: 11 * 60,
      coreEndMinutes: 15 * 60,
    });

    expect(response.status).toBe(201);
    expect((await response.json()) as LaborSystemAssignmentRecord).toMatchObject({
      systemType: 'flex',
      settlementMonths: 3,
    });
  });

  it('裁量労働はみなし分数が無ければ受け付けない', async () => {
    const response = await assign(app(), {
      employeeId: fixture.employeeId,
      systemType: 'discretionary',
      effectiveFrom: '2026-04-01',
    });

    expect(response.status).toBe(409);
  });

  it('期間が重なる割当は作れない', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      systemType: 'normal',
      effectiveFrom: '2026-04-01',
    });

    const overlapping = await assign(instance, {
      employeeId: fixture.employeeId,
      systemType: 'discretionary',
      effectiveFrom: '2026-06-01',
      deemedMinutes: 8 * 60,
    });

    expect(overlapping.status).toBe(409);
  });

  it('終了日を設定してから次の制度を始められる', async () => {
    const instance = app();
    const created = (await (
      await assign(instance, {
        employeeId: fixture.employeeId,
        systemType: 'normal',
        effectiveFrom: '2026-04-01',
      })
    ).json()) as LaborSystemAssignmentRecord;

    const ended = await instance.request(
      `/api/labor-system-assignments/${created.id}/end`,
      authorized(fixture.adminCookie, { method: 'POST', body: { effectiveTo: '2026-05-31' } }),
    );
    expect(ended.status).toBe(200);

    const next = await assign(instance, {
      employeeId: fixture.employeeId,
      systemType: 'discretionary',
      effectiveFrom: '2026-06-01',
      deemedMinutes: 8 * 60,
    });
    expect(next.status).toBe(201);
  });

  it('一覧は対象従業員を見られる利用者だけが取れる', async () => {
    const instance = app();
    await assign(instance, {
      employeeId: fixture.employeeId,
      systemType: 'normal',
      effectiveFrom: '2026-04-01',
    });

    const listed = await instance.request(
      `/api/labor-system-assignments?employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { laborSystemAssignments: LaborSystemAssignmentRecord[] })
        .laborSystemAssignments,
    ).toHaveLength(1);
  });
});
