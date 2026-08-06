/**
 * 勤怠の時刻を、拠点のタイムゾーンで読み書きする。
 *
 * 画面は、見ている人の端末ではなく、その勤怠が属する拠点の時計で表示する。
 * 海外拠点、出張、VPN、管理者が別の拠点を確認する場合に、
 * 端末の時計で読むと表示も入力もずれる。
 *
 * 変換をここへ集める。画面ごとに書くと、書いた画面だけが正しくなる。
 */
import { instantFromLocal, localMinutesOfDay } from '@staffweave/domain';

/** `datetime-local` が受け取る形。秒は持たない。 */
const LOCAL_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatterCache.get(timeZone);
  if (cached) return cached;
  // en-CA は YYYY-MM-DD 形式を返す。
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  dateFormatterCache.set(timeZone, formatter);
  return formatter;
}

/** 拠点の時計での時刻（`HH:mm`）。 */
export function formatInstantInTimeZone(
  iso: string,
  timeZone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return new Date(iso).toLocaleString(locale, { ...options, timeZone });
}

/** 拠点の時計での日時（`YYYY-MM-DDTHH:mm`）。`datetime-local` へ渡す。 */
export function instantToZonedLocalInput(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  const date = dateFormatterFor(timeZone).format(instant);
  const minutes = localMinutesOfDay(instant, timeZone);
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return `${date}T${hour}:${minute}`;
}

export type ZonedInputProblem = 'malformed' | 'nonexistent';

export interface ZonedInputResult {
  iso: string | null;
  problem: ZonedInputProblem | null;
}

/**
 * `datetime-local` の値を、拠点の時計として読んで絶対時刻にする。
 *
 * 夏時間で進む日には、存在しない現地時刻がある。`2026-03-08T02:30` を
 * `America/New_York` として読むと、どこにも当たらない。
 * 黙って近い時刻へ寄せると、利用者が入れた時刻と保存される時刻が食い違う。
 * 往復して一致しない場合は、存在しない時刻として返す。
 *
 * 戻る日には、同じ現地時刻が 2 回訪れる。どちらも実在するため、先に来るほう
 * （夏時間側）を採る。曖昧さを画面で選ばせるより、常に同じ側を採るほうが
 * 結果を読み替えやすい。ずれた場合は打刻の訂正で直せる。
 */
export function zonedLocalInputToInstant(value: string, timeZone: string): ZonedInputResult {
  if (!LOCAL_INPUT_PATTERN.test(value)) return { iso: null, problem: 'malformed' };

  const [date, time] = value.split('T');
  const [hour, minute] = (time ?? '').split(':').map(Number);
  if (date === undefined || hour === undefined || minute === undefined) {
    return { iso: null, problem: 'malformed' };
  }

  const instant = instantFromLocal(date, hour * 60 + minute, timeZone);
  if (Number.isNaN(instant.getTime())) return { iso: null, problem: 'malformed' };

  // 読み戻して一致しなければ、その現地時刻は存在しない。
  if (instantToZonedLocalInput(instant.toISOString(), timeZone) !== value) {
    return { iso: null, problem: 'nonexistent' };
  }
  return { iso: instant.toISOString(), problem: null };
}
