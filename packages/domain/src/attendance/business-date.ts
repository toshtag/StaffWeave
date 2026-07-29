/**
 * 業務日の判定。
 *
 * 勤務は暦日と一致しない。深夜勤務のように日付をまたぐ勤務を一日として扱うため、
 * 「業務日の開始時刻」を基準に、絶対時刻から所属する業務日を決める。
 */

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
 * @param dayStartMinutes 業務日の開始時刻（現地時間の 0 時からの分数）。
 *   たとえば 300 なら 5:00 開始となり、深夜 2:00 の打刻は前日の業務日に属する。
 */
export function businessDateOf(instant: Date, timeZone: string, dayStartMinutes = 0): BusinessDate {
  const shifted = new Date(instant.getTime() - dayStartMinutes * 60_000);
  return formatterFor(timeZone).format(shifted);
}

/** 業務日の前後関係を比較する。文字列比較で足りるが、意図を明示するために関数にする。 */
export function compareBusinessDates(left: BusinessDate, right: BusinessDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
