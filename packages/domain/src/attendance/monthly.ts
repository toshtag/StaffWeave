/**
 * 月次の集計。
 *
 * 日次の計算を足し合わせる。日次が正本で、月次は導いた値として持つ。
 * 月次だけを別に積み上げると、日次を直したときに合わなくなる。
 *
 * 未設定は 0 にしない。法定の閾値が決まっていない月は、合計も `null` にする。
 * 0 にすると「法定時間外が 0 分だった」と読めてしまい、
 * 「そもそも法定の区分を計算していない」ことが伝わらない。
 * 1 日でも未設定の日があれば、その区分の月合計は出さない。
 */

export interface DailyTotals {
  businessDate: string;
  attendedMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number;
  withinScheduleMinutes: number;
  outsideScheduleMinutes: number;
  nightMinutes: number;
  nonWorkingDayMinutes: number;
  leaveMinutes: number;
  absenceMinutes: number;
  legalInsideOvertimeMinutes: number | null;
  legalOvertimeMinutes: number | null;
  legalHolidayMinutes: number | null;
  nonLegalHolidayMinutes: number | null;
  nightOvertimeMinutes: number | null;
  nightHolidayMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  deemedMinutes: number | null;
  recognizedOvertimeMinutes: number | null;
  unapprovedOvertimeMinutes: number | null;
  approvedHolidayMinutes: number | null;
  unapprovedHolidayMinutes: number | null;
}

export interface MonthlySummary {
  /** 対象月の 1 日。 */
  period: string;
  attendedMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number;
  withinScheduleMinutes: number;
  outsideScheduleMinutes: number;
  nightMinutes: number;
  nonWorkingDayMinutes: number;
  leaveMinutes: number;
  absenceMinutes: number;
  legalInsideOvertimeMinutes: number | null;
  legalOvertimeMinutes: number | null;
  legalHolidayMinutes: number | null;
  nonLegalHolidayMinutes: number | null;
  nightOvertimeMinutes: number | null;
  nightHolidayMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  deemedMinutes: number | null;
  /** 承認しきった申請から来る、認定した分と認定の外に出た分。 */
  recognizedOvertimeMinutes: number | null;
  unapprovedOvertimeMinutes: number | null;
  approvedHolidayMinutes: number | null;
  unapprovedHolidayMinutes: number | null;
  /** 実労働が 1 分でもあった日の数。 */
  workedDays: number;
  /** 休暇として数えた日の数。 */
  leaveDays: number;
  /** 集計へ入れた日の数。 */
  countedDays: number;
}

const PLAIN_KEYS = [
  'attendedMinutes',
  'workedMinutes',
  'breakMinutes',
  'scheduledMinutes',
  'withinScheduleMinutes',
  'outsideScheduleMinutes',
  'nightMinutes',
  'nonWorkingDayMinutes',
  'leaveMinutes',
  'absenceMinutes',
] as const;

const NULLABLE_KEYS = [
  'legalInsideOvertimeMinutes',
  'legalOvertimeMinutes',
  'legalHolidayMinutes',
  'nonLegalHolidayMinutes',
  'nightOvertimeMinutes',
  'nightHolidayMinutes',
  'lateMinutes',
  'earlyLeaveMinutes',
  'deemedMinutes',
  'recognizedOvertimeMinutes',
  'unapprovedOvertimeMinutes',
  'approvedHolidayMinutes',
  'unapprovedHolidayMinutes',
] as const;

/** その月の 1 日。 */
export function periodOf(businessDate: string): string {
  return `${businessDate.slice(0, 7)}-01`;
}

/**
 * 日次の計算を月へ足し合わせる。
 *
 * @param days その月に属する日。並び順は問わない。
 */
export function summarizeMonth(period: string, days: readonly DailyTotals[]): MonthlySummary {
  const summary: MonthlySummary = {
    period,
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
    workedDays: 0,
    leaveDays: 0,
    countedDays: days.length,
  };

  for (const day of days) {
    for (const key of PLAIN_KEYS) summary[key] += day[key];

    for (const key of NULLABLE_KEYS) {
      const total = summary[key];
      const value = day[key];
      // 1 日でも未設定なら、その区分の月合計は出さない。
      // 未設定の日を 0 として足すと、足りない合計が正しい値の顔をして残る。
      summary[key] = total === null || value === null ? null : total + value;
    }

    if (day.workedMinutes > 0) summary.workedDays += 1;
    if (day.leaveMinutes > 0) summary.leaveDays += 1;
  }

  return summary;
}
