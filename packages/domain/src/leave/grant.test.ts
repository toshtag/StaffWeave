/**
 * 休暇の付与規則。
 *
 * ここで固定したいのは 3 つ。
 *
 *   勤続を暦月で数え、記念日より前に段が上がらないこと
 *   規則が無ければ 1 分も付与しないこと
 *   付与しなかった相手と理由が残ること
 */
import { describe, expect, it } from 'vitest';
import type { LeaveGrantRule } from './grant.js';
import { grantMinutesFor, planLeaveGrants, serviceMonthsBetween } from './grant.js';

const DAY = 8 * 60;

/** 勤続 6 か月で 10 日、1 年 6 か月で 11 日。 */
const rules: LeaveGrantRule[] = [
  { serviceMonths: 6, minutes: 10 * DAY },
  { serviceMonths: 18, minutes: 11 * DAY },
];

describe('勤続月数', () => {
  it('入社日と同じ日に達したところで 1 か月とする', () => {
    expect(serviceMonthsBetween('2026-01-15', '2026-02-14')).toBe(0);
    expect(serviceMonthsBetween('2026-01-15', '2026-02-15')).toBe(1);
  });

  it('31 日の月が続いても、記念日より前に段が上がらない', () => {
    // 1/31 入社。3/30 はまだ 1 か月と 29 日。
    expect(serviceMonthsBetween('2026-01-31', '2026-03-30')).toBe(1);
    expect(serviceMonthsBetween('2026-01-31', '2026-03-31')).toBe(2);
  });

  it('年をまたいでも数え落とさない', () => {
    expect(serviceMonthsBetween('2025-04-01', '2026-10-01')).toBe(18);
  });
});

describe('段の選び方', () => {
  it('達している段のうち、いちばん大きいものを採る', () => {
    expect(grantMinutesFor(rules, 6)).toBe(10 * DAY);
    expect(grantMinutesFor(rules, 17)).toBe(10 * DAY);
    expect(grantMinutesFor(rules, 18)).toBe(11 * DAY);
  });

  it('達している段が無ければ、付与しない', () => {
    expect(grantMinutesFor(rules, 5)).toBeNull();
  });

  it('規則が無ければ、付与しない', () => {
    expect(grantMinutesFor([], 120)).toBeNull();
  });
});

describe('付与の計画', () => {
  const candidates = [
    { employeeId: 'a', hiredOn: '2025-04-01' },
    { employeeId: 'b', hiredOn: '2026-01-15' },
    { employeeId: 'c', hiredOn: null },
  ];

  it('一斉付与では、勤続の足りている全員が対象になる', () => {
    const plan = planLeaveGrants({
      basis: 'fixed_date',
      effectiveOn: '2026-10-01',
      rules,
      candidates,
    });

    expect(plan.grants).toEqual([
      { employeeId: 'a', minutes: 11 * DAY, serviceMonths: 18 },
      { employeeId: 'b', minutes: 10 * DAY, serviceMonths: 8 },
    ]);
    expect(plan.skipped).toEqual([{ employeeId: 'c', reason: 'no_hire_date' }]);
  });

  it('入社日基準では、その日が記念日の人だけが対象になる', () => {
    const plan = planLeaveGrants({
      basis: 'hire_anniversary',
      effectiveOn: '2026-10-01',
      rules,
      candidates,
    });

    expect(plan.grants).toEqual([]);
    expect(plan.skipped).toEqual([
      { employeeId: 'a', reason: 'not_anniversary' },
      { employeeId: 'b', reason: 'not_anniversary' },
      { employeeId: 'c', reason: 'no_hire_date' },
    ]);
  });

  it('入社日基準の記念日には、その人だけへ付与する', () => {
    const plan = planLeaveGrants({
      basis: 'hire_anniversary',
      effectiveOn: '2026-04-01',
      rules,
      candidates,
    });

    expect(plan.grants).toEqual([{ employeeId: 'a', minutes: 10 * DAY, serviceMonths: 12 }]);
  });

  it('入社より前の日には付与しない', () => {
    const plan = planLeaveGrants({
      basis: 'fixed_date',
      effectiveOn: '2025-01-01',
      rules,
      candidates: [{ employeeId: 'a', hiredOn: '2025-04-01' }],
    });

    expect(plan.grants).toEqual([]);
    expect(plan.skipped).toEqual([{ employeeId: 'a', reason: 'no_rule_reached' }]);
  });

  it('規則が 1 つも無ければ、誰にも付与しない', () => {
    const plan = planLeaveGrants({
      basis: 'fixed_date',
      effectiveOn: '2026-10-01',
      rules: [],
      candidates,
    });

    expect(plan.grants).toEqual([]);
    expect(plan.skipped).toHaveLength(3);
  });
});
