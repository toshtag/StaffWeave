/**
 * 業務日の判定。
 *
 * 勤務は暦日と一致しない。深夜勤務のように日付をまたぐ勤務を一日として扱うため、
 * 「業務日の開始時刻」を基準に、絶対時刻から所属する業務日を決める。
 */

import { localMinutesOfDay } from './local-time.js';

/** `YYYY-MM-DD` 形式の業務日。 */
export type BusinessDate = string;

export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: string): value is BusinessDate {
  if (!BUSINESS_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // en-CA は YYYY-MM-DD 形式を返すため、そのまま業務日として使える。
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * 絶対時刻が所属する業務日を求める。
 *
 * 現地の暦日と現地の時刻へ分解してから、開始時刻と比べて決める。
 *
 * 絶対時刻から開始分を引いてから日付にすると、オフセットが変わる日でずれる。
 * `America/New_York` の業務日開始 5:00 で、現地 2026-03-08 05:00 は当日に属するが、
 * 引き算では前日を返していた。切り替えの当日だけ 1 時間ずれるため、
 * 平常時の検査には現れない。
 *
 * @param dayStartMinutes 業務日の開始時刻（現地時間の 0 時からの分数）。
 *   たとえば 300 なら 5:00 開始となり、深夜 2:00 の打刻は前日の業務日に属する。
 */
export function businessDateOf(instant: Date, timeZone: string, dayStartMinutes = 0): BusinessDate {
  const localDate = formatterFor(timeZone).format(instant);
  if (dayStartMinutes === 0) return localDate;
  return localMinutesOfDay(instant, timeZone) < dayStartMinutes
    ? addDaysToBusinessDate(localDate, -1)
    : localDate;
}

/** 業務日の前後関係を比較する。文字列比較で足りるが、意図を明示するために関数にする。 */
export function compareBusinessDates(left: BusinessDate, right: BusinessDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 月を足す。日は、足した先の月に無ければその月の末日へ丸める。
 *
 * `Date` に任せると、1 月 31 日の 1 か月後が 3 月 3 日になる。
 * 清算期間の区切りにも休暇の失効日にも、繰り上がった日付は使えない。
 */
export function addMonthsToBusinessDate(date: BusinessDate, months: number): BusinessDate {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`業務日として解釈できません: ${date}`);
  }
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (((total % 12) + 12) % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/** 曜日。0 が日曜。業務日は暦日なので、実行環境の時計に依らず UTC で読む。 */
export function weekdayOfBusinessDate(date: BusinessDate): number {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`業務日として解釈できません: ${date}`);
  }
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDaysToBusinessDate(date: BusinessDate, days: number): BusinessDate {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`業務日として解釈できません: ${date}`);
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const shiftedYear = String(shifted.getUTCFullYear()).padStart(4, '0');
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}
