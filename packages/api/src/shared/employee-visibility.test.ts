import type { EmployeeOrganizationView } from '@staffweave/domain';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedContext } from '../identity/service.js';
import type { AssignmentRepository } from '../organization/assignment-repository.js';
import { createEmployeeVisibilityGuard } from './employee-visibility.js';

/**
 * 閲覧範囲の判定が、何を読むかを固定する。
 *
 * 判定の結果は、ワークスペース全体を読んでも対象だけを読んでも変わらない。
 * 変わるのは読む量だけであり、それはここでしか確かめられない。
 */

const NOW = new Date('2026-04-01T00:00:00.000Z');
const HOST_ORGANIZATION = 'organization-host';

/** 受入組織 H に、期間つきで配属されている従業員。 */
function assigned(): EmployeeOrganizationView {
  return {
    employerOrganizationId: 'organization-employer',
    hostOrganizations: [
      { organizationId: HOST_ORGANIZATION, startsOn: '2026-01-01', endsOn: null },
    ],
  };
}

function context(): AuthenticatedContext {
  return {
    workspace: {
      id: 'workspace-1',
      slug: 'default',
      name: '既定',
      timeZone: 'Asia/Tokyo',
    },
    user: {
      id: 'user-1',
      workspaceId: 'workspace-1',
      email: 'manager@example.com',
      passwordHash: 'hash',
      displayName: '管理 太郎',
      locale: 'ja-JP',
      status: 'active',
    },
    roles: ['organization_manager'],
    employee: null,
    organizationScopes: [HOST_ORGANIZATION],
    sessionExpiresAt: new Date('2026-04-01T12:00:00.000Z'),
  };
}

/** 問い合わせた従業員を記録する。返す内容は、渡された従業員に対してだけ用意する。 */
function recordingAssignments(known: Record<string, EmployeeOrganizationView>): {
  asked: string[][];
  assignments: AssignmentRepository;
} {
  const asked: string[][] = [];
  const assignments = {
    async listEmployeeOrganizations(_workspaceId: string, employeeIds: readonly string[]) {
      asked.push([...employeeIds]);
      const found = new Map<string, EmployeeOrganizationView>();
      for (const employeeId of employeeIds) {
        const view = known[employeeId];
        if (view !== undefined) found.set(employeeId, view);
      }
      return found;
    },
  } as unknown as AssignmentRepository;
  return { asked, assignments };
}

function guard(known: Record<string, EmployeeOrganizationView>) {
  const { asked, assignments } = recordingAssignments(known);
  return { asked, guard: createEmployeeVisibilityGuard({ assignments, now: () => NOW }) };
}

const PERIOD = { from: '2026-04-01', to: '2026-04-30' };

describe('requireVisibleEmployee', () => {
  it('対象の従業員だけを問い合わせる', async () => {
    const { asked, guard: visibility } = guard({ 'employee-1': assigned() });

    await visibility.requireVisibleEmployee(context(), 'employee-1', PERIOD);

    expect(asked).toEqual([['employee-1']]);
  });

  it('配属が見つからない従業員は見られない', async () => {
    const { guard: visibility } = guard({});

    await expect(
      visibility.requireVisibleEmployee(context(), 'employee-1', PERIOD),
    ).rejects.toThrow();
  });
});

describe('filterVisible', () => {
  it('一覧に載っている従業員だけを問い合わせる', async () => {
    const { asked, guard: visibility } = guard({
      'employee-1': assigned(),
      'employee-2': assigned(),
    });

    const items = [{ employeeId: 'employee-1' }, { employeeId: 'employee-2' }];
    const visible = await visibility.filterVisible(context(), items, (item) => item.employeeId);

    expect(asked).toEqual([['employee-1', 'employee-2']]);
    expect(visible).toEqual(items);
  });

  it('同じ従業員が何行あっても、一度しか問い合わせない', async () => {
    const { asked, guard: visibility } = guard({ 'employee-1': assigned() });

    await visibility.filterVisible(
      context(),
      [{ employeeId: 'employee-1' }, { employeeId: 'employee-1' }, { employeeId: null }],
      (item) => item.employeeId,
    );

    expect(asked).toEqual([['employee-1']]);
  });

  it('従業員に紐づかない行だけなら問い合わせない', async () => {
    const { asked, guard: visibility } = guard({});

    const items = [{ employeeId: null }, { employeeId: null }];
    const visible = await visibility.filterVisible(context(), items, (item) => item.employeeId);

    expect(asked).toEqual([]);
    expect(visible).toEqual(items);
  });

  it('ワークスペース全体を見られる相手には問い合わせない', async () => {
    const { asked, guard: visibility } = guard({});
    const admin: AuthenticatedContext = { ...context(), roles: ['workspace_admin'] };

    await visibility.filterVisible(admin, [{ employeeId: 'employee-1' }], (i) => i.employeeId);

    expect(asked).toEqual([]);
  });
});

describe('要求の中での使い回し', () => {
  it('検査と絞り込みを続けて行っても、同じ従業員を二度読まない', async () => {
    const { asked, guard: visibility } = guard({ 'employee-1': assigned() });
    const current = context();

    await visibility.requireVisibleEmployee(current, 'employee-1', PERIOD);
    await visibility.filterVisible(current, [{ employeeId: 'employee-1' }], (i) => i.employeeId);

    expect(asked).toEqual([['employee-1']]);
  });

  it('まだ読んでいない従業員だけを足して問い合わせる', async () => {
    const { asked, guard: visibility } = guard({
      'employee-1': assigned(),
      'employee-2': assigned(),
    });
    const current = context();

    await visibility.requireVisibleEmployee(current, 'employee-1', PERIOD);
    await visibility.filterVisible(
      current,
      [{ employeeId: 'employee-1' }, { employeeId: 'employee-2' }],
      (item) => item.employeeId,
    );

    expect(asked).toEqual([['employee-1'], ['employee-2']]);
  });

  it('別の要求では読み直す', async () => {
    const { asked, guard: visibility } = guard({ 'employee-1': assigned() });

    await visibility.requireVisibleEmployee(context(), 'employee-1', PERIOD);
    await visibility.requireVisibleEmployee(context(), 'employee-1', PERIOD);

    expect(asked).toEqual([['employee-1'], ['employee-1']]);
  });
});
