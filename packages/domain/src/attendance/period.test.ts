/**
 * 週と清算期間の区切り、そして期間の合計。
 *
 * ここで固定したいのは 3 つ。
 *
 *   月をまたいでも日を数え落とさず、二度も数えないこと
 *   起算日が月末に近くても、区切りが 1 つずれないこと
 *   割当の外の日を、期間へ混ぜないこと
 */
import { describe, expect, it } from 'vitest';
import type { DailyTotals } from './monthly.js';
import {
  differenceFromTotal,
  settlementPeriodOf,
  settlementPeriodsBetween,
  summarizeDays,
  weekStartOf,
  weeksBetween,
} from './period.js';

/** 0 が日曜。 */
const SUNDAY = 0;
const MONDAY = 1;

describe('週の区切り', () => {
  it('日曜始まりでは、その週の日曜を返す', () => {
    // 2026-04-01 は水曜。
    expect(weekStartOf('2026-04-01', SUNDAY)).toBe('2026-03-29');
  });

  it('月曜始まりでは、その週の月曜を返す', () => {
    expect(weekStartOf('2026-04-01', MONDAY)).toBe('2026-03-30');
  });

  it('開始曜日そのものの日は、その日を返す', () => {
    expect(weekStartOf('2026-03-30', MONDAY)).toBe('2026-03-30');
  });

  it('月をまたいでも、週は 7 日のまま並ぶ', () => {
    const weeks = weeksBetween('2026-04-01', '2026-04-30', MONDAY);

    expect(weeks[0]).toEqual({ from: '2026-03-30', to: '2026-04-05' });
    expect(weeks.at(-1)).toEqual({ from: '2026-04-27', to: '2026-05-03' });
    // 週どうしが重ならず、間も空かない。
    for (let index = 1; index < weeks.length; index += 1) {
      const previous = weeks[index - 1];
      const current = weeks[index];
      if (previous === undefined || current === undefined) throw new Error('週が欠けています');
      expect(new Date(current.from).getTime() - new Date(previous.from).getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
    }
  });

  it('開始日が終了日より後なら、週は無い', () => {
    expect(weeksBetween('2026-04-10', '2026-04-01', MONDAY)).toEqual([]);
  });
});

describe('清算期間の区切り', () => {
  it('3 か月の期間を、起算日から区切る', () => {
    expect(settlementPeriodOf('2026-04-01', 3, '2026-05-15')).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
    expect(settlementPeriodOf('2026-04-01', 3, '2026-07-01')).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
  });

  it('起算日より前の日には、期間が無い', () => {
    expect(settlementPeriodOf('2026-04-01', 3, '2026-03-31')).toBeNull();
  });

  it('起算日が月末でも、区切りが 1 つずれない', () => {
    // 1/31 起算の 1 か月区切り。2 月は 28 日までしかないため、
    // 次の区切りは 2/28 になる。
    expect(settlementPeriodOf('2026-01-31', 1, '2026-02-01')).toEqual({
      from: '2026-01-31',
      to: '2026-02-27',
    });
    expect(settlementPeriodOf('2026-01-31', 1, '2026-02-28')).toEqual({
      from: '2026-02-28',
      to: '2026-03-30',
    });
  });

  it('1 年ぶんの期間でも、当たりを付け直して正しい区切りを返す', () => {
    expect(settlementPeriodOf('2026-04-01', 1, '2027-03-15')).toEqual({
      from: '2027-03-01',
      to: '2027-03-31',
    });
  });

  it('期間に重なる清算期間を、古い順に並べる', () => {
    const periods = settlementPeriodsBetween('2026-04-01', 3, '2026-05-01', '2026-10-31');

    expect(periods).toEqual([
      { from: '2026-04-01', to: '2026-06-30' },
      { from: '2026-07-01', to: '2026-09-30' },
      { from: '2026-10-01', to: '2026-12-31' },
    ]);
  });

  it('割当が効いている範囲で切り詰める', () => {
    // 5/15 に制度が始まり、8/20 で終わる割当。
    const periods = settlementPeriodsBetween('2026-04-01', 3, '2026-04-01', '2026-12-31', {
      from: '2026-05-15',
      to: '2026-08-20',
    });

    expect(periods).toEqual([
      { from: '2026-05-15', to: '2026-06-30' },
      { from: '2026-07-01', to: '2026-08-20' },
    ]);
  });

  it('起算日より前から探し始めても、最初の期間から並ぶ', () => {
    const periods = settlementPeriodsBetween('2026-04-01', 1, '2026-01-01', '2026-05-31');

    expect(periods).toEqual([
      { from: '2026-04-01', to: '2026-04-30' },
      { from: '2026-05-01', to: '2026-05-31' },
    ]);
  });
});

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
    recognizedOvertimeMinutes: 0,
    unapprovedOvertimeMinutes: 0,
    approvedHolidayMinutes: 0,
    unapprovedHolidayMinutes: 0,
    ...overrides,
  };
}

describe('期間の合計', () => {
  it('日次を足し合わせる', () => {
    const totals = summarizeDays([
      day({ businessDate: '2026-04-01', workedMinutes: 480 }),
      day({ businessDate: '2026-04-02', workedMinutes: 420 }),
    ]);

    expect(totals).toMatchObject({ workedMinutes: 900, workedDays: 2, countedDays: 2 });
  });

  it('1 日でも未設定なら、その区分の合計は出さない', () => {
    const totals = summarizeDays([
      day({ businessDate: '2026-04-01', legalOvertimeMinutes: 60 }),
      day({ businessDate: '2026-04-02', legalOvertimeMinutes: null }),
    ]);

    expect(totals.legalOvertimeMinutes).toBeNull();
  });

  it('認定した所定外も、未設定を 0 に化けさせない', () => {
    const totals = summarizeDays([
      day({ businessDate: '2026-04-01', recognizedOvertimeMinutes: 120 }),
      day({ businessDate: '2026-04-02', recognizedOvertimeMinutes: null }),
    ]);

    expect(totals.recognizedOvertimeMinutes).toBeNull();
  });
});

describe('総枠との差', () => {
  it('総枠が決まっていれば、差を出す', () => {
    expect(differenceFromTotal(10_000, 9_600)).toBe(400);
  });

  it('総枠が決まっていなければ、差も出さない', () => {
    expect(differenceFromTotal(10_000, null)).toBeNull();
  });
});
