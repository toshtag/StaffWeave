import { describe, expect, it } from 'vitest';
import type { WorkCycle, WorkCycleAssignment } from './work-cycle.js';
import {
  cyclePositionOf,
  resolveCycleDay,
  selectAssignment,
  validateWorkCycle,
} from './work-cycle.js';

/** 週休 3 日（7 日周期のうち 4 日勤務）。曜日は前提にしない。 */
const fourDayWeek: WorkCycle = {
  id: 'cycle-1',
  code: 'FOUR_DAY',
  name: '週 4 日勤務',
  cycleLength: 7,
  days: [
    { position: 0, dayType: 'working_day', workPatternId: 'pattern-day' },
    { position: 1, dayType: 'working_day', workPatternId: 'pattern-day' },
    { position: 2, dayType: 'working_day', workPatternId: 'pattern-day' },
    { position: 3, dayType: 'working_day', workPatternId: 'pattern-day' },
    { position: 4, dayType: 'non_working_day', workPatternId: null },
    { position: 5, dayType: 'non_working_day', workPatternId: null },
    { position: 6, dayType: 'non_working_day', workPatternId: null },
  ],
};

/** 2 日勤務 2 日休みの 4 日周期。週とは無関係に回る。 */
const twoOnTwoOff: WorkCycle = {
  id: 'cycle-2',
  code: 'TWO_ON_TWO_OFF',
  name: '2 勤 2 休',
  cycleLength: 4,
  days: [
    { position: 0, dayType: 'working_day', workPatternId: 'pattern-night' },
    { position: 1, dayType: 'working_day', workPatternId: 'pattern-night' },
    { position: 2, dayType: 'non_working_day', workPatternId: null },
    { position: 3, dayType: 'non_working_day', workPatternId: null },
  ],
};

const assignment: WorkCycleAssignment = {
  workCycleId: 'cycle-1',
  anchorDate: '2026-04-01',
  effectiveFrom: '2026-04-01',
  effectiveTo: null,
};

describe('cyclePositionOf', () => {
  it('起点日は位置 0', () => {
    expect(cyclePositionOf('2026-04-01', '2026-04-01', 7)).toBe(0);
  });

  it('周期をまたぐと先頭へ戻る', () => {
    expect(cyclePositionOf('2026-04-01', '2026-04-08', 7)).toBe(0);
    expect(cyclePositionOf('2026-04-01', '2026-04-09', 7)).toBe(1);
  });

  it('起点より前の日でも負にならない', () => {
    expect(cyclePositionOf('2026-04-08', '2026-04-01', 7)).toBe(0);
    expect(cyclePositionOf('2026-04-08', '2026-04-06', 7)).toBe(5);
  });

  it('週と無関係な長さでも回る', () => {
    expect(cyclePositionOf('2026-04-01', '2026-04-05', 4)).toBe(0);
    expect(cyclePositionOf('2026-04-01', '2026-04-06', 4)).toBe(1);
  });

  it('長さが 0 以下なら例外を投げる', () => {
    expect(() => cyclePositionOf('2026-04-01', '2026-04-02', 0)).toThrow(/1 以上/);
  });
});

describe('resolveCycleDay', () => {
  it('週 4 日勤務の勤務日と休日を決める', () => {
    expect(resolveCycleDay(fourDayWeek, assignment, '2026-04-01')?.dayType).toBe('working_day');
    expect(resolveCycleDay(fourDayWeek, assignment, '2026-04-04')?.dayType).toBe('working_day');
    expect(resolveCycleDay(fourDayWeek, assignment, '2026-04-05')?.dayType).toBe('non_working_day');
    expect(resolveCycleDay(fourDayWeek, assignment, '2026-04-08')?.dayType).toBe('working_day');
  });

  it('勤務日には勤務パターンが決まる', () => {
    expect(resolveCycleDay(fourDayWeek, assignment, '2026-04-01')?.workPatternId).toBe(
      'pattern-day',
    );
    expect(resolveCycleDay(fourDayWeek, assignment, '2026-04-05')?.workPatternId).toBeNull();
  });

  it('週と無関係な周期でも同じ仕組みで決まる', () => {
    const nightAssignment: WorkCycleAssignment = {
      workCycleId: 'cycle-2',
      anchorDate: '2026-04-01',
      effectiveFrom: '2026-04-01',
      effectiveTo: null,
    };

    expect(resolveCycleDay(twoOnTwoOff, nightAssignment, '2026-04-02')?.dayType).toBe(
      'working_day',
    );
    expect(resolveCycleDay(twoOnTwoOff, nightAssignment, '2026-04-03')?.dayType).toBe(
      'non_working_day',
    );
    expect(resolveCycleDay(twoOnTwoOff, nightAssignment, '2026-04-05')?.dayType).toBe(
      'working_day',
    );
  });
});

describe('selectAssignment', () => {
  const first: WorkCycleAssignment = {
    workCycleId: 'cycle-1',
    anchorDate: '2026-01-01',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-03-31',
  };
  const second: WorkCycleAssignment = {
    workCycleId: 'cycle-2',
    anchorDate: '2026-04-01',
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
  };

  it('期間に含まれる割当を選ぶ', () => {
    expect(selectAssignment([first, second], '2026-02-15')?.workCycleId).toBe('cycle-1');
    expect(selectAssignment([first, second], '2026-05-01')?.workCycleId).toBe('cycle-2');
  });

  it('期間の外なら何も選ばない', () => {
    expect(selectAssignment([first], '2026-04-01')).toBeNull();
    expect(selectAssignment([second], '2026-03-31')).toBeNull();
  });

  it('期間が重なっていれば開始が後のものを選ぶ', () => {
    const overlapping: WorkCycleAssignment = { ...second, effectiveFrom: '2026-02-01' };
    expect(selectAssignment([first, overlapping], '2026-02-15')?.workCycleId).toBe('cycle-2');
  });

  // 期間が重ならないことは DB の制約で決めているが、選び方まで並び順に委ねない。
  it('開始日が同じ割当でも渡す順序で結果が変わらない', () => {
    const sameDay: WorkCycleAssignment = { ...second, workCycleId: 'cycle-3' };

    expect(selectAssignment([second, sameDay], '2026-05-01')?.workCycleId).toBe(
      selectAssignment([sameDay, second], '2026-05-01')?.workCycleId,
    );
  });
});

describe('validateWorkCycle', () => {
  it('過不足なく位置が埋まっていれば問題なし', () => {
    expect(validateWorkCycle(fourDayWeek)).toEqual([]);
  });

  it('位置が足りなければ指摘する', () => {
    expect(validateWorkCycle({ cycleLength: 7, days: fourDayWeek.days.slice(0, 5) })).toContain(
      'missing_position',
    );
  });

  it('範囲外の位置を指摘する', () => {
    expect(
      validateWorkCycle({
        cycleLength: 2,
        days: [
          { position: 0, dayType: 'non_working_day', workPatternId: null },
          { position: 5, dayType: 'non_working_day', workPatternId: null },
        ],
      }),
    ).toContain('position_out_of_range');
  });

  it('勤務日に勤務パターンが無ければ指摘する', () => {
    expect(
      validateWorkCycle({
        cycleLength: 1,
        days: [{ position: 0, dayType: 'working_day', workPatternId: null }],
      }),
    ).toContain('working_day_without_pattern');
  });

  it('長さが不正なら他を見ずに返す', () => {
    expect(validateWorkCycle({ cycleLength: 0, days: [] })).toEqual(['invalid_length']);
  });
});
