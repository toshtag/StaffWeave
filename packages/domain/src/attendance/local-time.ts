/**
 * 現地時間への変換。
 *
 * 深夜帯の判定や所定時刻の解釈は、必ず拠点のタイムゾーンで行う。
 * 実行環境のタイムゾーンに依存しないよう、変換はここへ集約する。
 */

const MINUTES_PER_DAY = 24 * 60;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsOf(instant: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)?.value;
    return found === undefined ? 0 : Number(found);
  };
  // 24 時制では真夜中が 24 と表現される環境がある。
  const hour = value('hour') % 24;
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour,
    minute: value('minute'),
  };
}

/** 現地時間の 0 時からの経過分。 */
export function localMinutesOfDay(instant: Date, timeZone: string): number {
  const parts = partsOf(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

/**
 * 現地時間の日付と分から絶対時刻を求める。
 *
 * タイムゾーンのずれを二分探索せずに済ませるため、
 * 一度 UTC として仮定した時刻のずれを測り、それを打ち消す方法を使う。
 * 夏時間の切り替え時刻をまたぐ場合も、補正を 2 回行えば収束する。
 */
export function instantFromLocal(date: string, minutesOfDay: number, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`業務日として解釈できません: ${date}`);
  }

  const target = Date.UTC(year, month - 1, day) + minutesOfDay * 60_000;
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsOf(new Date(guess), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const difference = asUtc - target;
    if (difference === 0) break;
    guess -= difference;
  }

  return new Date(guess);
}

export { MINUTES_PER_DAY };
