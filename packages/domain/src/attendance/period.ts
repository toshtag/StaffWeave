/**
 * 月より長い（あるいは短い）期間の集計。
 *
 * 週、フレックスタイム制の清算期間、変形労働時間制の対象期間を扱う。
 * どれも日次の計算を足し合わせるだけで、日次が正本であることは変えない。
 *
 * 期間の区切りは事業者が決める。週の開始曜日は計算規則の版が、
 * 清算期間と対象期間は労働形態の割当が持つ。製品は既定値を置かない。
 * 決まっていない期間は、区切りを作らずに「決まっていない」ことを返す。
 */

import type { BusinessDate } from './business-date.js';
import {
  addDaysToBusinessDate,
  addMonthsToBusinessDate,
  weekdayOfBusinessDate,
} from './business-date.js';
import type { DailyTotals } from './monthly.js';

/** 期間の種類。 */
export const PERIOD_KINDS = ['week', 'settlement'] as const;

export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface PeriodBounds {
  /** 期間の最初の日。 */
  from: BusinessDate;
  /** 期間の最後の日。この日を含む。 */
  to: BusinessDate;
}

/**
 * その日を含む週の最初の日。
 *
 * @param weekStartsOn 週の開始曜日（0 が日曜）。
 */
export function weekStartOf(date: BusinessDate, weekStartsOn: number): BusinessDate {
  const offset = (weekdayOfBusinessDate(date) - weekStartsOn + 7) % 7;
  return addDaysToBusinessDate(date, -offset);
}

/**
 * 期間に重なる週を、古い順に並べる。
 *
 * 端の週は切り詰めない。切り詰めると、月末で切った週の合計が
 * 「その週に働いた時間」ではなくなる。範囲の外へはみ出した週も丸ごと返し、
 * どこからどこまでを数えたのかを呼ぶ側へ示す。
 */
export function weeksBetween(
  from: BusinessDate,
  to: BusinessDate,
  weekStartsOn: number,
): PeriodBounds[] {
  if (from > to) return [];
  const weeks: PeriodBounds[] = [];
  let start = weekStartOf(from, weekStartsOn);
  while (start <= to) {
    weeks.push({ from: start, to: addDaysToBusinessDate(start, 6) });
    start = addDaysToBusinessDate(start, 7);
  }
  return weeks;
}

/** 週の区切りを決める規則の版。適用開始日で切り替わる。 */
export interface WeekRuleVersion {
  effectiveFrom: BusinessDate;
  /** 週の開始曜日（0 が日曜）。 */
  weekStartsOn: number;
}

/**
 * 規則の版が途中で変わる範囲の週を、古い順に並べる。
 *
 * 週の開始曜日は計算規則の版が持ち、適用開始日で切り替わる。
 * 範囲の始まりの版を全体へ使うと、切り替えの前後で週の区切りがずれる。
 * 切り替え日をまたぐ週は、その前日で区切り、切り替え日から次の週を始める。
 * こうすると週どうしが重ならず、範囲の全ての日がどれか 1 つの週へ入る。
 *
 * 端の週は切り詰めない。範囲の外へはみ出した週も丸ごと返し、
 * どこからどこまでを数えたのかを呼ぶ側へ示す。
 */
export function weeksBetweenWithRules(
  from: BusinessDate,
  to: BusinessDate,
  versions: readonly WeekRuleVersion[],
): PeriodBounds[] {
  if (from > to) return [];

  const ordered = [...versions].sort((left, right) =>
    left.effectiveFrom < right.effectiveFrom
      ? -1
      : left.effectiveFrom > right.effectiveFrom
        ? 1
        : 0,
  );
  const weekStartsOnAt = (date: BusinessDate): number => {
    let value = 0;
    for (const version of ordered) {
      if (version.effectiveFrom > date) break;
      value = version.weekStartsOn;
    }
    return value;
  };

  const weeks: PeriodBounds[] = [];
  let cursor = weekStartOf(from, weekStartsOnAt(from));

  while (cursor <= to) {
    // 切り替えで週の途中から始まっていても、その週の終わりは
    // いま効いている版の並びに合わせる。次の週からは並びへ戻る。
    const aligned = addDaysToBusinessDate(weekStartOf(cursor, weekStartsOnAt(cursor)), 6);
    const change = ordered.find(
      (version) => version.effectiveFrom > cursor && version.effectiveFrom <= aligned,
    );
    const end = change === undefined ? aligned : addDaysToBusinessDate(change.effectiveFrom, -1);
    weeks.push({ from: cursor, to: end });
    cursor = addDaysToBusinessDate(end, 1);
  }
  return weeks;
}

/**
 * 期間の並びを覆う範囲。
 *
 * 日次をどこまで読めばよいかを決めるために使う。要求された範囲だけを読むと、
 * 清算期間のように要求より広い期間を返すとき、期間の一部しか足せない。
 * 足りない合計は、正しい値の顔をして残る。
 */
export function boundsCovering(periods: readonly PeriodBounds[]): PeriodBounds | null {
  if (periods.length === 0) return null;
  let from = periods[0]?.from as BusinessDate;
  let to = periods[0]?.to as BusinessDate;
  for (const period of periods) {
    if (period.from < from) from = period.from;
    if (period.to > to) to = period.to;
  }
  return { from, to };
}

/**
 * その日を含む清算期間（対象期間）。
 *
 * 起算日から `months` か月ずつ区切る。起算日より前の日には期間が無い。
 * 制度が始まる前の日を、最初の期間へ含めるわけにはいかない。
 *
 * @param startsOn 起算日。労働形態の割当が持つ。
 * @param months 期間の長さ（月数）。
 */
export function settlementPeriodOf(
  startsOn: BusinessDate,
  months: number,
  date: BusinessDate,
): PeriodBounds | null {
  if (months <= 0 || date < startsOn) return null;

  // 月数の差から当たりを付けて、前後 1 つぶんだけ確かめる。
  // 起算日の日が月末に近いと丸めが入り、差の割り算だけでは 1 つずれる。
  const monthsOf = (value: BusinessDate): number => {
    const [year, month] = value.split('-').map(Number);
    return (year ?? 0) * 12 + ((month ?? 1) - 1);
  };
  const guess = Math.floor((monthsOf(date) - monthsOf(startsOn)) / months);

  for (const index of [guess - 1, guess, guess + 1]) {
    if (index < 0) continue;
    const start = addMonthsToBusinessDate(startsOn, index * months);
    const next = addMonthsToBusinessDate(startsOn, (index + 1) * months);
    if (start <= date && date < next) {
      return { from: start, to: addDaysToBusinessDate(next, -1) };
    }
  }
  return null;
}

/**
 * 期間に重なる清算期間を、古い順に並べる。
 *
 * @param bounds 割当が効いている範囲。期間はここで切り詰める。
 *   在籍していない日や、制度が変わったあとの日を同じ期間へ混ぜないため。
 */
export function settlementPeriodsBetween(
  startsOn: BusinessDate,
  months: number,
  from: BusinessDate,
  to: BusinessDate,
  bounds?: { from: BusinessDate; to: BusinessDate | null },
): PeriodBounds[] {
  if (from > to) return [];
  const periods: PeriodBounds[] = [];
  let cursor = from;

  while (cursor <= to) {
    const period = settlementPeriodOf(startsOn, months, cursor);
    if (period === null) {
      // 起算日より前。次の日から探し直す。日ごとに進めても、
      // 起算日へ届いた時点で期間が見つかるため空回りは有限で終わる。
      cursor = startsOn > cursor ? startsOn : addDaysToBusinessDate(cursor, 1);
      continue;
    }
    const clipped = clip(period, bounds);
    if (clipped !== null) periods.push(clipped);
    cursor = addDaysToBusinessDate(period.to, 1);
  }
  return periods;
}

function clip(
  period: PeriodBounds,
  bounds?: { from: BusinessDate; to: BusinessDate | null },
): PeriodBounds | null {
  if (bounds === undefined) return period;
  const from = period.from > bounds.from ? period.from : bounds.from;
  const to = bounds.to === null || period.to < bounds.to ? period.to : bounds.to;
  return from > to ? null : { from, to };
}

export interface PeriodTotals {
  workedMinutes: number;
  scheduledMinutes: number;
  outsideScheduleMinutes: number;
  nightMinutes: number;
  nonWorkingDayMinutes: number;
  leaveMinutes: number;
  absenceMinutes: number;
  /** 認定した所定外。1 日でも未設定なら null。 */
  recognizedOvertimeMinutes: number | null;
  /** 法定時間外。1 日でも未設定なら null。 */
  legalOvertimeMinutes: number | null;
  workedDays: number;
  countedDays: number;
}

const PLAIN_KEYS = [
  'workedMinutes',
  'scheduledMinutes',
  'outsideScheduleMinutes',
  'nightMinutes',
  'nonWorkingDayMinutes',
  'leaveMinutes',
  'absenceMinutes',
] as const;

const NULLABLE_KEYS = ['recognizedOvertimeMinutes', 'legalOvertimeMinutes'] as const;

/**
 * 期間の合計。
 *
 * 未設定は 0 にしない。1 日でも未設定の日があれば、その区分の合計は出さない。
 * 0 にすると、足りない合計が正しい値の顔をして残る。
 */
export function summarizeDays(days: readonly DailyTotals[]): PeriodTotals {
  const totals: PeriodTotals = {
    workedMinutes: 0,
    scheduledMinutes: 0,
    outsideScheduleMinutes: 0,
    nightMinutes: 0,
    nonWorkingDayMinutes: 0,
    leaveMinutes: 0,
    absenceMinutes: 0,
    recognizedOvertimeMinutes: 0,
    legalOvertimeMinutes: 0,
    workedDays: 0,
    countedDays: days.length,
  };

  for (const day of days) {
    for (const key of PLAIN_KEYS) totals[key] += day[key];
    for (const key of NULLABLE_KEYS) {
      const running = totals[key];
      const value = day[key];
      totals[key] = running === null || value === null ? null : running + value;
    }
    if (day.workedMinutes > 0) totals.workedDays += 1;
  }
  return totals;
}

/**
 * 総枠との差。
 *
 * 総枠が決まっていなければ差も出さない。0 を返すと「ちょうど総枠だった」と読める。
 */
export function differenceFromTotal(
  workedMinutes: number,
  totalMinutes: number | null,
): number | null {
  return totalMinutes === null ? null : workedMinutes - totalMinutes;
}
