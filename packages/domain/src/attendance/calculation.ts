/**
 * 勤怠計算エンジン。
 *
 * 同じ入力からは必ず同じ結果が出る。時計も乱数も参照しない。
 * 結果には「どの入力を、どのルールで、どう数えたか」を根拠として添え、
 * 後から人が検算できるようにする。
 *
 * 計算は分単位で行う。区間を 1 分ずつ数えることで、
 * 夏時間の切り替えや日付をまたぐ勤務でも数え落としが起きない。
 */
import type { BusinessDate } from './business-date.js';
import type { AttendanceEvent, BreakPeriod } from './events.js';
import { summarizeWorkDay } from './events.js';
import { localMinutesOfDay } from './local-time.js';

const MINUTE = 60_000;

/**
 * 勤務日の種別。
 * `leave` は休暇、`absence` は欠勤。どちらも予定はあるが働かない日として扱う。
 */
export const DAY_TYPES = [
  'working_day',
  'non_working_day',
  'public_holiday',
  'leave',
  'absence',
] as const;

export type DayType = (typeof DAY_TYPES)[number];

export function isDayType(value: string): value is DayType {
  return (DAY_TYPES as readonly string[]).includes(value);
}

export interface WorkSchedule {
  dayType: DayType;
  /** 所定始業。休日など予定が無い場合は null。 */
  startAt: Date | null;
  /** 所定終業。日をまたぐ勤務では翌日の時刻になる。 */
  endAt: Date | null;
  /** 所定休憩の分数。 */
  breakMinutes: number;
}

export type RoundingMode = 'none' | 'down' | 'nearest';

export interface CalculationRules {
  /** ルール版。結果と一緒に保存し、どの規則で計算したかを追えるようにする。 */
  version: string;
  /** 深夜帯の開始（現地 0 時からの分数）。既定は 22:00。 */
  nightStartMinutes: number;
  /** 深夜帯の終了（現地 0 時からの分数）。既定は 5:00。 */
  nightEndMinutes: number;
  /** 集計の丸め単位（分）。0 なら丸めない。 */
  roundingMinutes: number;
  roundingMode: RoundingMode;
}

export const DEFAULT_CALCULATION_RULES: CalculationRules = {
  version: 'v1',
  nightStartMinutes: 22 * 60,
  nightEndMinutes: 5 * 60,
  roundingMinutes: 0,
  roundingMode: 'none',
};

export interface CalculationInput {
  businessDate: BusinessDate;
  timeZone: string;
  events: readonly AttendanceEvent[];
  schedule: WorkSchedule | null;
  rules: CalculationRules;
}

export interface CalculationStep {
  label: string;
  minutes: number;
}

export interface CalculationSegment {
  kind: 'work' | 'break';
  startAt: string;
  endAt: string;
  minutes: number;
}

export interface CalculationBasis {
  ruleVersion: string;
  timeZone: string;
  dayType: DayType;
  segments: CalculationSegment[];
  steps: CalculationStep[];
  /** 勤務が確定していない（退勤していない）場合は true。 */
  incomplete: boolean;
}

export interface CalculationResult {
  businessDate: BusinessDate;
  /** 在社時間（休憩を含む出勤から退勤まで）。 */
  attendedMinutes: number;
  /** 実労働時間（在社時間から休憩を除いたもの）。 */
  workedMinutes: number;
  breakMinutes: number;
  /** 所定労働時間。休日や予定が無い日は 0。 */
  scheduledMinutes: number;
  /** 所定の時間帯に含まれる実労働。 */
  withinScheduleMinutes: number;
  /** 所定の時間帯の外で働いた実労働。 */
  outsideScheduleMinutes: number;
  /** 深夜帯に含まれる実労働。 */
  nightMinutes: number;
  /** 休日・祝日に働いた実労働。 */
  nonWorkingDayMinutes: number;
  /** 休暇として扱う時間。実労働ではない。 */
  leaveMinutes: number;
  /** 欠勤として扱う時間。実労働ではない。 */
  absenceMinutes: number;
  basis: CalculationBasis;
}

function floorToMinute(instant: Date): number {
  return Math.floor(instant.getTime() / MINUTE) * MINUTE;
}

/** 現地時間の分が深夜帯に含まれるか。深夜帯は日をまたぐ。 */
function isNightMinute(minuteOfDay: number, rules: CalculationRules): boolean {
  const { nightStartMinutes, nightEndMinutes } = rules;
  if (nightStartMinutes === nightEndMinutes) return false;
  if (nightStartMinutes < nightEndMinutes) {
    return minuteOfDay >= nightStartMinutes && minuteOfDay < nightEndMinutes;
  }
  return minuteOfDay >= nightStartMinutes || minuteOfDay < nightEndMinutes;
}

function applyRounding(minutes: number, rules: CalculationRules): number {
  if (rules.roundingMinutes <= 0 || rules.roundingMode === 'none') return minutes;
  const unit = rules.roundingMinutes;
  if (rules.roundingMode === 'down') return Math.floor(minutes / unit) * unit;
  return Math.round(minutes / unit) * unit;
}

interface Interval {
  start: number;
  end: number;
}

function overlaps(intervals: readonly Interval[], instant: number): boolean {
  return intervals.some((interval) => instant >= interval.start && instant < interval.end);
}

function toSegment(kind: 'work' | 'break', interval: Interval): CalculationSegment {
  return {
    kind,
    startAt: new Date(interval.start).toISOString(),
    endAt: new Date(interval.end).toISOString(),
    minutes: Math.max(0, Math.round((interval.end - interval.start) / MINUTE)),
  };
}

function breakIntervals(breaks: readonly BreakPeriod[], attendance: Interval | null): Interval[] {
  const intervals: Interval[] = [];
  for (const period of breaks) {
    const start = floorToMinute(period.startedAt);
    // 終わっていない休憩は、在社時間の終わりまでを休憩とみなす。
    const end =
      period.endedAt === null ? (attendance?.end ?? start) : floorToMinute(period.endedAt);
    if (end > start) intervals.push({ start, end });
  }
  return intervals;
}

/**
 * 一日分の勤怠を計算する。
 *
 * 退勤していない日は、その時点までを数えず `incomplete` として扱い、
 * 在社時間だけを最後の打刻までで示す。確定した数値と途中経過を混同させないため。
 */
export function calculateWorkDay(input: CalculationInput): CalculationResult {
  const summary = summarizeWorkDay(input.businessDate, input.events);
  const rules = input.rules;
  const dayType = input.schedule?.dayType ?? 'working_day';

  const attendance: Interval | null =
    summary.firstClockInAt === null
      ? null
      : {
          start: floorToMinute(summary.firstClockInAt),
          end: floorToMinute(
            summary.lastClockOutAt ??
              summary.breaks.at(-1)?.endedAt ??
              summary.breaks.at(-1)?.startedAt ??
              summary.firstClockInAt,
          ),
        };

  const breaks = breakIntervals(summary.breaks, attendance);

  const scheduleInterval: Interval | null =
    input.schedule?.startAt && input.schedule.endAt
      ? { start: floorToMinute(input.schedule.startAt), end: floorToMinute(input.schedule.endAt) }
      : null;

  let attendedMinutes = 0;
  let workedMinutes = 0;
  let breakMinutes = 0;
  let withinScheduleMinutes = 0;
  let outsideScheduleMinutes = 0;
  let nightMinutes = 0;

  if (attendance) {
    for (let instant = attendance.start; instant < attendance.end; instant += MINUTE) {
      attendedMinutes += 1;
      if (overlaps(breaks, instant)) {
        breakMinutes += 1;
        continue;
      }
      workedMinutes += 1;

      if (scheduleInterval !== null && overlaps([scheduleInterval], instant)) {
        withinScheduleMinutes += 1;
      } else {
        outsideScheduleMinutes += 1;
      }

      if (isNightMinute(localMinutesOfDay(new Date(instant), input.timeZone), rules)) {
        nightMinutes += 1;
      }
    }
  }

  // 休暇と欠勤は「予定はあるが働かない日」。所定労働は残し、働いた時間とは別に数える。
  const plannedDay = dayType === 'working_day' || dayType === 'leave' || dayType === 'absence';

  const scheduledMinutes =
    plannedDay && scheduleInterval !== null
      ? Math.max(
          0,
          Math.round((scheduleInterval.end - scheduleInterval.start) / MINUTE) -
            (input.schedule?.breakMinutes ?? 0),
        )
      : 0;

  const nonWorkingDayMinutes = plannedDay ? 0 : workedMinutes;
  const leaveMinutes = dayType === 'leave' ? scheduledMinutes : 0;
  const absenceMinutes = dayType === 'absence' ? scheduledMinutes : 0;

  const rounded = {
    attendedMinutes: applyRounding(attendedMinutes, rules),
    workedMinutes: applyRounding(workedMinutes, rules),
    breakMinutes: applyRounding(breakMinutes, rules),
    withinScheduleMinutes: applyRounding(withinScheduleMinutes, rules),
    outsideScheduleMinutes: applyRounding(outsideScheduleMinutes, rules),
    nightMinutes: applyRounding(nightMinutes, rules),
    nonWorkingDayMinutes: applyRounding(nonWorkingDayMinutes, rules),
    leaveMinutes: applyRounding(leaveMinutes, rules),
    absenceMinutes: applyRounding(absenceMinutes, rules),
  };

  const segments: CalculationSegment[] = [];
  if (attendance) segments.push(toSegment('work', attendance));
  for (const interval of breaks) segments.push(toSegment('break', interval));

  const basis: CalculationBasis = {
    ruleVersion: rules.version,
    timeZone: input.timeZone,
    dayType,
    segments,
    steps: [
      { label: '在社時間', minutes: rounded.attendedMinutes },
      { label: '休憩', minutes: rounded.breakMinutes },
      { label: '実労働', minutes: rounded.workedMinutes },
      { label: '所定内', minutes: rounded.withinScheduleMinutes },
      { label: '所定外', minutes: rounded.outsideScheduleMinutes },
      { label: '深夜帯', minutes: rounded.nightMinutes },
      { label: '休日労働', minutes: rounded.nonWorkingDayMinutes },
      { label: '休暇', minutes: rounded.leaveMinutes },
      { label: '欠勤', minutes: rounded.absenceMinutes },
      { label: '所定労働', minutes: scheduledMinutes },
    ],
    incomplete: summary.state !== 'finished' && summary.state !== 'not_started',
  };

  return {
    businessDate: input.businessDate,
    ...rounded,
    scheduledMinutes,
    basis,
  };
}

/**
 * 計算に使った入力を、順序が安定した文字列へ落とす。
 * この文字列のハッシュを入力版として保存し、入力が変わったかどうかを判定する。
 */
export function fingerprintSource(input: CalculationInput): string {
  const events = [...input.events]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((event) => `${event.eventType}@${event.occurredAt.toISOString()}`);

  const schedule =
    input.schedule === null
      ? 'none'
      : [
          input.schedule.dayType,
          input.schedule.startAt?.toISOString() ?? 'none',
          input.schedule.endAt?.toISOString() ?? 'none',
          String(input.schedule.breakMinutes),
        ].join('|');

  const rules = [
    input.rules.version,
    String(input.rules.nightStartMinutes),
    String(input.rules.nightEndMinutes),
    String(input.rules.roundingMinutes),
    input.rules.roundingMode,
  ].join('|');

  return [input.businessDate, input.timeZone, schedule, rules, events.join(',')].join('\n');
}
