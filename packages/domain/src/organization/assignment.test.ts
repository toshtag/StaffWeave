import { describe, expect, it } from 'vitest';
import type { AssignmentContract, EmployeeAssignment } from './assignment.js';
import {
  activeAssignmentAt,
  canAccessEmployee,
  contractCoversDate,
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

  it('閲覧範囲の指定が無ければ全員を見られる', () => {
    expect(canAccessEmployee([], employee)).toBe(true);
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
