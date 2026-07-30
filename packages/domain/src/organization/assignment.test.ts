import { describe, expect, it } from 'vitest';
import type { AssignmentContract, EmployeeAssignment } from './assignment.js';
import {
  activeAssignmentAt,
  canAccessEmployee,
  contractCoversDate,
  isEmployeeVisible,
  resolveEmployeeVisibility,
  seesWholeWorkspace,
  validateContractPeriod,
} from './assignment.js';

const contract: AssignmentContract = {
  id: 'contract-1',
  employerOrganizationId: 'employer',
  hostOrganizationId: 'host',
  startsOn: '2026-04-01',
  endsOn: '2026-09-30',
};

function assignment(id: string, startsOn: string, endsOn: string | null): EmployeeAssignment {
  return {
    id,
    employeeId: 'employee-1',
    assignmentContractId: 'contract-1',
    workplaceSiteId: null,
    startsOn,
    endsOn,
  };
}

describe('contractCoversDate', () => {
  it('期間内なら有効', () => {
    expect(contractCoversDate(contract, '2026-04-01')).toBe(true);
    expect(contractCoversDate(contract, '2026-09-30')).toBe(true);
  });

  it('期間外なら無効', () => {
    expect(contractCoversDate(contract, '2026-03-31')).toBe(false);
    expect(contractCoversDate(contract, '2026-10-01')).toBe(false);
  });

  it('終わりが決まっていなければ以降ずっと有効', () => {
    expect(contractCoversDate({ ...contract, endsOn: null }, '2030-01-01')).toBe(true);
  });
});

describe('activeAssignmentAt', () => {
  const first = assignment('assignment-1', '2026-04-01', '2026-06-30');
  const second = assignment('assignment-2', '2026-07-01', null);

  it('その日に有効な配属を返す', () => {
    expect(activeAssignmentAt([first, second], '2026-05-01')?.id).toBe('assignment-1');
    expect(activeAssignmentAt([first, second], '2026-08-01')?.id).toBe('assignment-2');
  });

  it('有効な配属が無ければ null', () => {
    expect(activeAssignmentAt([first, second], '2026-03-01')).toBeNull();
  });

  it('重なっていれば開始が後のものを採用する', () => {
    const overlapping = assignment('assignment-3', '2026-05-01', null);
    expect(activeAssignmentAt([first, overlapping], '2026-06-01')?.id).toBe('assignment-3');
  });
});

describe('canAccessEmployee', () => {
  const employee = {
    employerOrganizationId: 'employer',
    hostOrganizationIds: ['host'],
  };

  it('組織の指定が無ければ誰も見られない', () => {
    // 空配列は「すべて」ではなく「指定なし」。全体を見られるかはロールで決める。
    expect(canAccessEmployee([], employee)).toBe(false);
  });

  it('雇用元が範囲に含まれていれば見られる', () => {
    expect(canAccessEmployee(['employer'], employee)).toBe(true);
  });

  it('受入組織が範囲に含まれていれば見られる（外部承認者）', () => {
    expect(canAccessEmployee(['host'], employee)).toBe(true);
  });

  it('関係のない組織だけなら見られない', () => {
    expect(canAccessEmployee(['other'], employee)).toBe(false);
  });

  it('配属が無い従業員は雇用元でしか見られない', () => {
    const unassigned = { employerOrganizationId: 'employer', hostOrganizationIds: [] };
    expect(canAccessEmployee(['employer'], unassigned)).toBe(true);
    expect(canAccessEmployee(['host'], unassigned)).toBe(false);
  });
});

describe('resolveEmployeeVisibility', () => {
  it('ワークスペース管理者は全体を見られる', () => {
    expect(
      resolveEmployeeVisibility({
        roles: ['workspace_admin'],
        organizationIds: [],
        selfEmployeeId: null,
      }),
    ).toEqual({ kind: 'workspace' });
  });

  it('ワークスペース管理者は閲覧範囲を与えられていても全体を見られる', () => {
    expect(
      resolveEmployeeVisibility({
        roles: ['workspace_admin', 'organization_manager'],
        organizationIds: ['employer'],
        selfEmployeeId: 'employee-1',
      }),
    ).toEqual({ kind: 'workspace' });
  });

  it('組織管理者は与えられた組織だけを見られる', () => {
    expect(
      resolveEmployeeVisibility({
        roles: ['organization_manager'],
        organizationIds: ['host'],
        selfEmployeeId: 'employee-1',
      }),
    ).toEqual({ kind: 'organizations', organizationIds: ['host'], selfEmployeeId: 'employee-1' });
  });

  it('閲覧範囲を持たない組織管理者は管理対象を持たない', () => {
    const visibility = resolveEmployeeVisibility({
      roles: ['organization_manager'],
      organizationIds: [],
      selfEmployeeId: null,
    });

    expect(visibility).toEqual({
      kind: 'organizations',
      organizationIds: [],
      selfEmployeeId: null,
    });
    expect(seesWholeWorkspace(visibility)).toBe(false);
  });

  it('一般従業員は自分だけを見られる', () => {
    expect(
      resolveEmployeeVisibility({
        roles: ['employee'],
        organizationIds: [],
        selfEmployeeId: 'employee-1',
      }),
    ).toEqual({ kind: 'self', employeeId: 'employee-1' });
  });

  it('従業員が紐づいていない一般利用者は誰も見られない', () => {
    expect(
      resolveEmployeeVisibility({
        roles: ['employee'],
        organizationIds: [],
        selfEmployeeId: null,
      }),
    ).toEqual({ kind: 'none' });
  });
});

describe('isEmployeeVisible', () => {
  const view = { employerOrganizationId: 'employer', hostOrganizationIds: ['host'] };

  it('ワークスペース全体なら組織を知らなくても見られる', () => {
    expect(isEmployeeVisible({ kind: 'workspace' }, 'employee-1')).toBe(true);
  });

  it('管理対象を持たない組織管理者は誰も見られない', () => {
    const visibility = {
      kind: 'organizations',
      organizationIds: [],
      selfEmployeeId: null,
    } as const;
    expect(isEmployeeVisible(visibility, 'employee-1', view)).toBe(false);
  });

  it('管理対象を持たない組織管理者でも自分自身は見られる', () => {
    const visibility = {
      kind: 'organizations',
      organizationIds: [],
      selfEmployeeId: 'employee-1',
    } as const;
    expect(isEmployeeVisible(visibility, 'employee-1')).toBe(true);
    expect(isEmployeeVisible(visibility, 'employee-2', view)).toBe(false);
  });

  it('範囲内の組織に属する従業員だけを見られる', () => {
    const visibility = {
      kind: 'organizations',
      organizationIds: ['host'],
      selfEmployeeId: null,
    } as const;
    expect(isEmployeeVisible(visibility, 'employee-1', view)).toBe(true);
    expect(
      isEmployeeVisible(visibility, 'employee-2', {
        employerOrganizationId: 'other',
        hostOrganizationIds: [],
      }),
    ).toBe(false);
  });

  it('組織の対応が分からない従業員は自分自身でなければ見られない', () => {
    const visibility = {
      kind: 'organizations',
      organizationIds: ['host'],
      selfEmployeeId: null,
    } as const;
    expect(isEmployeeVisible(visibility, 'employee-1', undefined)).toBe(false);
  });

  it('一般従業員は自分だけを見られる', () => {
    expect(isEmployeeVisible({ kind: 'self', employeeId: 'employee-1' }, 'employee-1')).toBe(true);
    expect(isEmployeeVisible({ kind: 'self', employeeId: 'employee-1' }, 'employee-2')).toBe(false);
  });

  it('誰も見られない場合は自分の ID でも見られない', () => {
    expect(isEmployeeVisible({ kind: 'none' }, 'employee-1')).toBe(false);
  });
});

describe('validateContractPeriod', () => {
  it('終了が開始より前なら指摘する', () => {
    expect(validateContractPeriod({ startsOn: '2026-04-01', endsOn: '2026-03-31' })).toEqual([
      'invalid_period',
    ]);
  });

  it('同じ日なら問題なし', () => {
    expect(validateContractPeriod({ startsOn: '2026-04-01', endsOn: '2026-04-01' })).toEqual([]);
  });

  it('終わりが決まっていなければ問題なし', () => {
    expect(validateContractPeriod({ startsOn: '2026-04-01', endsOn: null })).toEqual([]);
  });
});
