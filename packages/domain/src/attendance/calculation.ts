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

import type { AutoBreakRule, MinuteInterval } from './breaks.js';
import { resolveBreaks } from './breaks.js';
import type { BusinessDate } from './business-date.js';
import type { AttendanceEvent, BreakPeriod } from './events.js';
import { summarizeWorkDay } from './events.js';
import { instantFromLocal, localMinutesOfDay } from './local-time.js';

const MINUTE = 60_000;

/**
 * 勤務日の種別。
 * `leave` は休暇、`absence` は欠勤。どちらも予定はあるが働かない日として扱う。
 */
export const DAY_TYPES = [
  'working_day',
  'non_working_day',
  // 法定休日。法定外休日と分けて数えるため、種別として持つ。
  'legal_holiday',
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
  /** 深夜帯の開始（現地 0 時からの分数）。 */
  nightStartMinutes: number;
  /** 深夜帯の終了（現地 0 時からの分数）。 */
  nightEndMinutes: number;
  /** 集計の丸め単位（分）。0 なら丸めない。 */
  roundingMinutes: number;
  roundingMode: RoundingMode;
  /**
   * 法定内と法定外を分ける 1 日の閾値（分）。
   *
   * 事業者が決める値で、製品は既定値を持たない。
   * 未設定のまま計算すると、誰も決めていない値が結果に残る。
   * `null` の間は法定の区分を出さず、未設定として示す。
   */
  dailyLegalMinutes: number | null;
}

/**
 * 何も設定されていない状態。
 *
 * 深夜帯と丸めは、これまで動いていた値をそのまま引き継ぐ。
 * 法定の閾値は持たない。持たせると、設定しないまま法定内外が出てしまう。
 */
export const DEFAULT_CALCULATION_RULES: CalculationRules = {
  version: 'v1',
  nightStartMinutes: 22 * 60,
  nightEndMinutes: 5 * 60,
  roundingMinutes: 0,
  roundingMode: 'none',
  dailyLegalMinutes: null,
};

/**
 * その日に適用する勤務区分。
 *
 * 勤務予定に紐づく版を渡す。渡さない場合は、これまでどおり勤務予定の
 * 所定時刻と休憩分数だけで計算する。
 */
export interface WorkCategorySettings {
  code: string;
  /** 固定休憩（現地 0 時からの分数）。 */
  fixedBreaks: readonly { startMinutes: number; endMinutes: number }[];
  /** 自動休憩の規則。 */
  autoBreaks: readonly AutoBreakRule[];
  /** 深夜帯の上書き。null なら計算規則に従う。 */
  nightStartMinutes: number | null;
  nightEndMinutes: number | null;
  /** 区間と区間の間の扱い。 */
  gapTreatment: 'non_working' | 'break';
  /** みなし労働分数。給与向けの値として実績とは別に持つ。 */
  deemedMinutes: number | null;
}

/**
 * 承認しきった申請から来る、その日の認定の条件。
 *
 * ここへ渡すのは `approved` になった申請だけ。提出しただけの申請、
 * 差し戻された申請、取り下げた申請は渡さない。
 * 途中の段で計算が動くと、承認する前に結果が変わってしまう。
 */
export interface ApprovedAdjustments {
  /**
   * 認定する残業の終わりの時刻（業務日の現地 0 時からの分数）。
   *
   * 日をまたぐ残業では 1440 を超える。承認しきった残業の申請が複数あれば、
   * いちばん遅い時刻を採る。承認が無ければ `null`。
   */
  overtimeLimitMinutes: number | null;
  /** 休日出勤の承認があるか。 */
  holidayWorkApproved: boolean;
}

/** 承認が 1 件も無い状態。 */
export const NO_APPROVED_ADJUSTMENTS: ApprovedAdjustments = {
  overtimeLimitMinutes: null,
  holidayWorkApproved: false,
};

export interface CalculationInput {
  businessDate: BusinessDate;
  timeZone: string;
  events: readonly AttendanceEvent[];
  schedule: WorkSchedule | null;
  rules: CalculationRules;
  category?: WorkCategorySettings | null;
  /** 承認しきった申請。渡さない場合は「承認が無い」として扱う。 */
  approvals?: ApprovedAdjustments | null;
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
  /**
   * 設定されていないため計算できなかった区分。
   *
   * 空でなければ、その区分は `null` になる。
   * 黙って 0 を返すと、設定し忘れに気付けない。
   */
  unconfigured: string[];
  /** 採用した休憩と、重なりで捨てた休憩。 */
  breakOrigins: { origin: string; minutes: number; adopted: boolean }[];
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

  /**
   * 法定の区分。
   *
   * 1 日の閾値が設定されていなければ `null`。0 ではない。
   * 0 だと「計算した結果 0 分だった」と読めてしまい、未設定と区別がつかない。
   */
  legalInsideOvertimeMinutes: number | null;
  legalOvertimeMinutes: number | null;
  /** 法定休日に働いた実労働。勤務区分の種別で決まる。 */
  legalHolidayMinutes: number;
  /** 法定外休日に働いた実労働。 */
  nonLegalHolidayMinutes: number;
  /** 深夜帯のうち、法定時間外に当たる分。閾値が未設定なら `null`。 */
  nightOvertimeMinutes: number | null;
  /** 深夜帯のうち、休日労働に当たる分。 */
  nightHolidayMinutes: number;

  /** 所定始業に遅れた分。所定が無ければ 0。 */
  lateMinutes: number;
  /** 所定終業より早く出た分。 */
  earlyLeaveMinutes: number;
  /** 所定始業より前に働いた分。 */
  beforeScheduleMinutes: number;
  /** 所定終業より後に働いた分。 */
  afterScheduleMinutes: number;

  /** みなし労働分数。勤務区分または労働形態が持つ場合だけ。 */
  deemedMinutes: number | null;

  /**
   * 認定した所定外の実労働。
   *
   * 承認しきった残業の申請が持つ上限時刻までに収まる、所定終業より後の実労働。
   * 承認が無ければ 0。0 は「認定した残業は無かった」という確かめられた事実で、
   * 未設定とは違う。所定の時間帯が決まっていない日だけ `null` になる。
   */
  recognizedOvertimeMinutes: number | null;
  /** 認定の外に出た所定外の実労働。上限を超えた分と、承認の無い所定外。 */
  unapprovedOvertimeMinutes: number | null;
  /** 承認のある休日労働。休日でなければ 0。 */
  approvedHolidayMinutes: number;
  /** 承認の無い休日労働。 */
  unapprovedHolidayMinutes: number;

  basis: CalculationBasis;
}

function floorToMinute(instant: Date): number {
  return Math.floor(instant.getTime() / MINUTE) * MINUTE;
}

/** 現地時間の分が深夜帯に含まれるか。深夜帯は日をまたぐ。 */
function isNightMinute(
  minuteOfDay: number,
  band: { nightStartMinutes: number; nightEndMinutes: number },
): boolean {
  const { nightStartMinutes, nightEndMinutes } = band;
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

  // 勤務の区間ごとに数える。区間と区間の間（中抜け）は在社にも実労働にも入れない。
  // 退勤していない区間は、その日の最後に分かっている時刻までを在社として示す。
  const sessions: Interval[] = summary.sessions
    .map((session) => {
      const fallback =
        summary.breaks.findLast((period) => period.startedAt >= session.startedAt)?.endedAt ??
        summary.breaks.findLast((period) => period.startedAt >= session.startedAt)?.startedAt ??
        session.startedAt;
      return {
        start: floorToMinute(session.startedAt),
        end: floorToMinute(session.endedAt ?? fallback),
      };
    })
    .filter((interval) => interval.end > interval.start);

  // 休憩を勤務の範囲へ収めるために、日全体の端を渡す。
  const first = sessions.at(0);
  const last = sessions.at(-1);
  const attendance: Interval | null =
    first === undefined || last === undefined ? null : { start: first.start, end: last.end };

  const category = input.category ?? null;

  // 実績・固定・自動を突き合わせ、同じ時間を二度引かないようにする。
  const actualBreaks = breakIntervals(summary.breaks, attendance);

  // 休憩の突き合わせは絶対時刻のまま行う。
  // 「現地 0 時からの分数」へ写すと、夏時間で長さの変わる日にずれる。
  // 固定休憩は現地時刻で決めるため、こちらを絶対時刻へ直す。
  const toMinutes = (instant: number): number => Math.round(instant / MINUTE);
  const fromMinutes = (minutes: number): number => minutes * MINUTE;
  const localToInstant = (minutesOfDay: number): number =>
    instantFromLocal(input.businessDate, minutesOfDay, input.timeZone).getTime();

  const rawWorkedMinutes =
    attendance === null
      ? 0
      : sessions.reduce((sum, session) => sum + (session.end - session.start) / MINUTE, 0) -
        actualBreaks.reduce((sum, interval) => sum + (interval.end - interval.start) / MINUTE, 0);

  const resolution = resolveBreaks({
    actual: actualBreaks.map<MinuteInterval>((interval) => ({
      start: toMinutes(interval.start),
      end: toMinutes(interval.end),
    })),
    fixed: (category?.fixedBreaks ?? []).map<MinuteInterval>((entry) => ({
      start: toMinutes(localToInstant(entry.startMinutes)),
      end: toMinutes(localToInstant(entry.endMinutes)),
    })),
    automatic: category?.autoBreaks ?? [],
    workedMinutes: rawWorkedMinutes,
  });

  const breaks: Interval[] = resolution.intervals.map((interval) => ({
    start: fromMinutes(interval.start),
    end: fromMinutes(interval.end),
  }));
  const automaticBreakMinutes = resolution.automaticMinutes;

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

  // 深夜帯は勤務区分で上書きできる。上書きが無ければ計算規則の版に従う。
  const nightBand = {
    nightStartMinutes: category?.nightStartMinutes ?? rules.nightStartMinutes,
    nightEndMinutes: category?.nightEndMinutes ?? rules.nightEndMinutes,
  };

  // 実労働の分を、あとで法定内外へ振り分けるために順番に覚えておく。
  const workedInstants: number[] = [];

  for (const session of sessions) {
    for (let instant = session.start; instant < session.end; instant += MINUTE) {
      attendedMinutes += 1;
      if (overlaps(breaks, instant)) {
        breakMinutes += 1;
        continue;
      }
      workedMinutes += 1;
      workedInstants.push(instant);

      if (scheduleInterval !== null && overlaps([scheduleInterval], instant)) {
        withinScheduleMinutes += 1;
      } else {
        outsideScheduleMinutes += 1;
      }

      if (isNightMinute(localMinutesOfDay(new Date(instant), input.timeZone), nightBand)) {
        nightMinutes += 1;
      }
    }
  }

  // 中抜けを休憩として扱う設定なら、区間の間を休憩へ足す。
  if (category?.gapTreatment === 'break') {
    for (let index = 1; index < sessions.length; index += 1) {
      const previous = sessions[index - 1];
      const current = sessions[index];
      if (previous === undefined || current === undefined) continue;
      breakMinutes += Math.max(0, Math.round((current.start - previous.end) / MINUTE));
    }
  }

  // 自動休憩は時間帯を持たない。実労働から直接引く。
  if (automaticBreakMinutes > 0) {
    const deducted = Math.min(automaticBreakMinutes, workedMinutes);
    workedMinutes -= deducted;
    breakMinutes += deducted;
    // 引いた分は、所定外から先に落とす。所定内を削ると所定を満たしていないように見える。
    const fromOutside = Math.min(deducted, outsideScheduleMinutes);
    outsideScheduleMinutes -= fromOutside;
    withinScheduleMinutes -= deducted - fromOutside;
    workedInstants.splice(workedInstants.length - deducted, deducted);
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

  const unconfigured: string[] = [];

  // 法定休日と法定外休日を分ける。どちらに当たるかは勤務区分の種別が決める。
  // 種別が渡らない日は、これまでどおり「休日労働」としてまとめたままにする。
  const legalHolidayMinutes = dayType === 'legal_holiday' ? workedMinutes : 0;
  const nonLegalHolidayMinutes =
    dayType === 'non_working_day' || dayType === 'public_holiday' ? workedMinutes : 0;

  // 法定内と法定外は、1 日の閾値が決まっていなければ計算しない。
  // 事業者が決める値で、製品が既定値を持つと、設定しないまま結果が出てしまう。
  let legalInsideOvertimeMinutes: number | null = null;
  let legalOvertimeMinutes: number | null = null;
  let nightOvertimeMinutes: number | null = null;
  const legalLimit = rules.dailyLegalMinutes;

  if (legalLimit === null) {
    unconfigured.push('法定内・法定外の 1 日の閾値');
  } else if (plannedDay) {
    const overtime = Math.max(0, workedMinutes - legalLimit);
    legalOvertimeMinutes = overtime;
    // 所定を超えたが法定内に収まる分。
    legalInsideOvertimeMinutes = Math.max(0, outsideScheduleMinutes - overtime);

    // 法定時間外に当たる分のうち、深夜帯に入るもの。
    // 閾値を超えたのは、その日の後ろから数えた分。
    const overtimeInstants = workedInstants.slice(workedInstants.length - overtime);
    nightOvertimeMinutes = overtimeInstants.filter((instant) =>
      isNightMinute(localMinutesOfDay(new Date(instant), input.timeZone), nightBand),
    ).length;
  } else {
    // 休日は所定が無い。法定内外ではなく休日労働として数える。
    legalInsideOvertimeMinutes = 0;
    legalOvertimeMinutes = 0;
    nightOvertimeMinutes = 0;
  }

  const nightHolidayMinutes = plannedDay
    ? 0
    : workedInstants.filter((instant) =>
        isNightMinute(localMinutesOfDay(new Date(instant), input.timeZone), nightBand),
      ).length;

  // 遅刻・早退・始業前・終業後。所定の時間帯が決まっていなければ 0。
  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let beforeScheduleMinutes = 0;
  let afterScheduleMinutes = 0;

  if (scheduleInterval !== null && plannedDay && workedInstants.length > 0) {
    const firstWorked = workedInstants[0] ?? 0;
    const lastWorked = (workedInstants.at(-1) ?? 0) + MINUTE;
    lateMinutes = Math.max(0, Math.round((firstWorked - scheduleInterval.start) / MINUTE));
    earlyLeaveMinutes = Math.max(0, Math.round((scheduleInterval.end - lastWorked) / MINUTE));
    beforeScheduleMinutes = workedInstants.filter(
      (instant) => instant < scheduleInterval.start,
    ).length;
    afterScheduleMinutes = workedInstants.filter(
      (instant) => instant >= scheduleInterval.end,
    ).length;
  }

  const deemedMinutes = category?.deemedMinutes ?? null;

  // 承認しきった申請だけを見る。提出しただけ・差し戻し・取消は渡ってこない。
  const approvals = input.approvals ?? NO_APPROVED_ADJUSTMENTS;

  // 認定する残業は、所定終業より後の実労働のうち、上限時刻より前の分だけ。
  //
  // 上限は「その時刻まで残業してよい」という終わりの取り決めなので、
  // 所定始業より前の実労働（早出）は、この上限では認められない。
  // 早出まで含めると、終業後の上限を承認しただけで早出まで認めたことになる。
  //
  // 上限は現地時刻で決まるため、絶対時刻へ直してから比べる。
  // 「0 時からの分数」のまま比べると、夏時間で長さの変わる日にずれる。
  let recognizedOvertimeMinutes: number | null = null;

  if (!plannedDay) {
    // 休日には所定が無い。残業ではなく休日労働として数える。
    recognizedOvertimeMinutes = 0;
  } else if (scheduleInterval !== null) {
    const scheduleEnd = scheduleInterval.end;
    const limit =
      approvals.overtimeLimitMinutes === null
        ? null
        : localToInstant(approvals.overtimeLimitMinutes);
    recognizedOvertimeMinutes =
      limit === null
        ? 0
        : workedInstants.filter((instant) => instant >= scheduleEnd && instant < limit).length;
  } else if (approvals.overtimeLimitMinutes === null) {
    // 所定終業が無く、承認も無い。認定する残業は無い。
    recognizedOvertimeMinutes = 0;
  } else {
    // 上限は承認されているのに、所定終業が決まっていない。
    // どこからが残業なのかを誰も決めていないため、0 を返さず未設定として示す。
    // 0 を返すと「承認したのに認定は 0 分だった」と読め、設定漏れに気付けない。
    unconfigured.push('所定の時間帯（残業の認定に要る）');
  }

  const approvedHolidayMinutes = approvals.holidayWorkApproved ? nonWorkingDayMinutes : 0;

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
    legalInsideOvertimeMinutes:
      legalInsideOvertimeMinutes === null ? null : applyRounding(legalInsideOvertimeMinutes, rules),
    legalOvertimeMinutes:
      legalOvertimeMinutes === null ? null : applyRounding(legalOvertimeMinutes, rules),
    legalHolidayMinutes: applyRounding(legalHolidayMinutes, rules),
    nonLegalHolidayMinutes: applyRounding(nonLegalHolidayMinutes, rules),
    nightOvertimeMinutes:
      nightOvertimeMinutes === null ? null : applyRounding(nightOvertimeMinutes, rules),
    nightHolidayMinutes: applyRounding(nightHolidayMinutes, rules),
    lateMinutes: applyRounding(lateMinutes, rules),
    earlyLeaveMinutes: applyRounding(earlyLeaveMinutes, rules),
    beforeScheduleMinutes: applyRounding(beforeScheduleMinutes, rules),
    afterScheduleMinutes: applyRounding(afterScheduleMinutes, rules),
    deemedMinutes,
    recognizedOvertimeMinutes:
      recognizedOvertimeMinutes === null ? null : applyRounding(recognizedOvertimeMinutes, rules),
    approvedHolidayMinutes: applyRounding(approvedHolidayMinutes, rules),
  };

  // 認定の外に出た分は、丸めたあとの所定外から引いて出す。
  // それぞれを別に丸めると、内訳の合計が所定外と合わなくなる。
  //
  // 休日には所定が無い。所定外という区分そのものを当てず、休日労働の側で数える。
  const unapprovedOvertimeMinutes =
    rounded.recognizedOvertimeMinutes === null
      ? null
      : plannedDay
        ? Math.max(0, rounded.outsideScheduleMinutes - rounded.recognizedOvertimeMinutes)
        : 0;
  const unapprovedHolidayMinutes = Math.max(
    0,
    rounded.nonWorkingDayMinutes - rounded.approvedHolidayMinutes,
  );

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
      ...(rounded.legalOvertimeMinutes === null
        ? []
        : [
            { label: '法定内時間外', minutes: rounded.legalInsideOvertimeMinutes ?? 0 },
            { label: '法定時間外', minutes: rounded.legalOvertimeMinutes },
            { label: '深夜時間外', minutes: rounded.nightOvertimeMinutes ?? 0 },
          ]),
      { label: '法定休日', minutes: rounded.legalHolidayMinutes },
      { label: '法定外休日', minutes: rounded.nonLegalHolidayMinutes },
      { label: '深夜休日', minutes: rounded.nightHolidayMinutes },
      { label: '遅刻', minutes: rounded.lateMinutes },
      { label: '早退', minutes: rounded.earlyLeaveMinutes },
      { label: '始業前', minutes: rounded.beforeScheduleMinutes },
      { label: '終業後', minutes: rounded.afterScheduleMinutes },
      ...(rounded.recognizedOvertimeMinutes === null
        ? []
        : [
            { label: '認定時間外', minutes: rounded.recognizedOvertimeMinutes },
            { label: '未承認の所定外', minutes: unapprovedOvertimeMinutes ?? 0 },
          ]),
      { label: '承認済みの休日労働', minutes: rounded.approvedHolidayMinutes },
      { label: '未承認の休日労働', minutes: unapprovedHolidayMinutes },
      ...(deemedMinutes === null ? [] : [{ label: 'みなし労働', minutes: deemedMinutes }]),
    ],
    incomplete: summary.state !== 'finished' && summary.state !== 'not_started',
    unconfigured,
    breakOrigins: [
      ...resolution.adopted.map((entry) => ({
        origin: entry.origin,
        minutes: entry.end - entry.start,
        adopted: true,
      })),
      ...resolution.overlapped.map((entry) => ({
        origin: entry.origin,
        minutes: entry.end - entry.start,
        adopted: false,
      })),
    ],
  };

  return {
    businessDate: input.businessDate,
    ...rounded,
    unapprovedOvertimeMinutes,
    unapprovedHolidayMinutes,
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

  // 勤務区分も指紋へ入れる。入れないと、固定休憩や深夜帯を変えても
  // 「入力は変わっていない」と判断され、前の版の結果が残る。
  //
  // 入れるのは計算へ効く値だけにする。表示名や色まで入れると、
  // 結果が変わらない編集で版が増え、履歴から本当の変更を追えなくなる。
  const category =
    input.category === null || input.category === undefined
      ? 'none'
      : [
          input.category.code,
          input.category.fixedBreaks
            .map((entry) => `${entry.startMinutes}-${entry.endMinutes}`)
            .join('+') || 'none',
          input.category.autoBreaks
            .map((rule) => `${rule.thresholdMinutes}>${rule.additionalMinutes}`)
            .join('+') || 'none',
          input.category.nightStartMinutes === null
            ? 'none'
            : `${input.category.nightStartMinutes}-${input.category.nightEndMinutes}`,
          input.category.gapTreatment,
          input.category.deemedMinutes === null ? 'none' : String(input.category.deemedMinutes),
        ].join('|');

  // 承認の内容も指紋へ入れる。入れないと、承認しても「入力は変わっていない」と
  // 判断され、認定を反映しないまま前の版が残る。
  const approvals = input.approvals ?? NO_APPROVED_ADJUSTMENTS;
  const approved = [
    approvals.overtimeLimitMinutes === null ? 'none' : String(approvals.overtimeLimitMinutes),
    approvals.holidayWorkApproved ? 'holiday' : 'no-holiday',
  ].join('|');

  return [
    input.businessDate,
    input.timeZone,
    schedule,
    rules,
    category,
    approved,
    events.join(','),
  ].join('\n');
}
