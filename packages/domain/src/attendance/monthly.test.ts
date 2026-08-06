/**
 * 月次の合計が、未設定を 0 に化けさせないことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { type DailyTotals, periodOf, summarizeMonth } from './monthly.js';

function day(overrides: Partial<DailyTotals> & { businessDate: string }): DailyTotals {
  return {
    attendedMinutes: 0,
    workedMinutes: 0,
    breakMinutes: 0,
    scheduledMinutes: 0,
    withinScheduleMinutes: 0,
    outsideScheduleMinutes: 0,
    nightMinutes: 0,
    nonWorkingDayMinutes: 0,
    leaveMinutes: 0,
    absenceMinutes: 0,
    legalInsideOvertimeMinutes: 0,
    legalOvertimeMinutes: 0,
    legalHolidayMinutes: 0,
    nonLegalHolidayMinutes: 0,
    nightOvertimeMinutes: 0,
    nightHolidayMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    deemedMinutes: 0,
    ...overrides,
  };
}

describe('月の合計', () => {
  it('日次を足し合わせる', () => {
    const summary = summarizeMonth('2026-04-01', [
      day({ businessDate: '2026-04-01', workedMinutes: 480, breakMinutes: 60 }),
      day({ businessDate: '2026-04-02', workedMinutes: 420, breakMinutes: 45 }),
    ]);

    expect(summary).toMatchObject({ workedMinutes: 900, breakMinutes: 105, countedDays: 2 });
  });

  it('働いた日と休んだ日を数える', () => {
    const summary = summarizeMonth('2026-04-01', [
      day({ businessDate: '2026-04-01', workedMinutes: 480 }),
      day({ businessDate: '2026-04-02', leaveMinutes: 480 }),
      day({ businessDate: '2026-04-03' }),
    ]);

    expect(summary).toMatchObject({ workedDays: 1, leaveDays: 1, countedDays: 3 });
  });

  it('1 日でも未設定なら、その区分の月合計は出さない', () => {
    const summary = summarizeMonth('2026-04-01', [
      day({ businessDate: '2026-04-01', legalOvertimeMinutes: 60 }),
      // 閾値を決めていない日。0 として足すと、足りない合計が正しい顔をして残る。
      day({ businessDate: '2026-04-02', legalOvertimeMinutes: null }),
    ]);

    expect(summary.legalOvertimeMinutes).toBeNull();
    // 未設定に関わらない区分は、そのまま合計する。
    expect(summary.workedMinutes).toBe(0);
  });

  it('未設定の日が後ろにあっても前にあっても、同じ結果になる', () => {
    const days = [
      day({ businessDate: '2026-04-01', legalOvertimeMinutes: null }),
      day({ businessDate: '2026-04-02', legalOvertimeMinutes: 60 }),
    ];

    expect(summarizeMonth('2026-04-01', days)).toEqual(
      summarizeMonth('2026-04-01', [...days].reverse()),
    );
  });

  it('日が無ければ、すべて 0 として返す', () => {
    expect(summarizeMonth('2026-04-01', [])).toMatchObject({
      workedMinutes: 0,
      legalOvertimeMinutes: 0,
      countedDays: 0,
    });
  });
});

describe('対象月', () => {
  it('業務日からその月の 1 日を出す', () => {
    expect(periodOf('2026-04-30')).toBe('2026-04-01');
    expect(periodOf('2026-12-01')).toBe('2026-12-01');
  });
});
