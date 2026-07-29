/**
 * PC セッションの観測と、勤怠との乖離。
 *
 * ここで扱うのは「PC がどう使われていたか」という観測であって、勤務時間そのものではない。
 * 観測から勤務時間を自動で確定させることはしない。
 * できるのは、打刻と食い違っている箇所を根拠つきで示し、人が確かめられるようにすることまで。
 */
import type { BusinessDate } from './business-date.js';
import type { BreakPeriod } from './events.js';

export const SESSION_OBSERVATION_TYPES = ['sign_in', 'sign_out', 'lock', 'unlock'] as const;

export type SessionObservationType = (typeof SESSION_OBSERVATION_TYPES)[number];

export function isSessionObservationType(value: string): value is SessionObservationType {
  return (SESSION_OBSERVATION_TYPES as readonly string[]).includes(value);
}

export interface SessionObservation {
  observationType: SessionObservationType;
  occurredAt: Date;
}

export interface ActivePeriod {
  startedAt: Date;
  /** 期間が閉じていない場合は null。 */
  endedAt: Date | null;
}

/**
 * 観測イベントから「PC が使われていた期間」を組み立てる。
 *
 * ログインと解除で開始し、ログオフとロックで終了する。
 * 重複した開始や、開始のない終了は読み飛ばす。観測は欠けることがあるため、
 * 厳密な状態機械にはせず、たどれる範囲で期間を作る。
 */
export function toActivePeriods(observations: readonly SessionObservation[]): ActivePeriod[] {
  const ordered = [...observations].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const periods: ActivePeriod[] = [];
  let open: ActivePeriod | null = null;

  for (const observation of ordered) {
    const starts =
      observation.observationType === 'sign_in' || observation.observationType === 'unlock';
    if (starts) {
      if (open === null) {
        open = { startedAt: observation.occurredAt, endedAt: null };
        periods.push(open);
      }
      continue;
    }

    if (open !== null) {
      open.endedAt = observation.occurredAt;
      open = null;
    }
  }

  return periods;
}

export const DISCREPANCY_KINDS = [
  'pc_active_before_clock_in',
  'pc_active_after_clock_out',
  'pc_active_during_break',
  'pc_active_without_attendance',
  'attendance_without_pc_activity',
] as const;

export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

export interface Discrepancy {
  kind: DiscrepancyKind;
  /** 食い違っている長さ（分）。 */
  minutes: number;
  /** 判断の根拠。画面へそのまま出せる形にする。 */
  evidence: {
    from: string | null;
    to: string | null;
    note: string;
  };
}

export interface DiscrepancyRules {
  /** この分数を超える食い違いだけを示す。短いずれで埋もれさせないため。 */
  toleranceMinutes: number;
}

export const DEFAULT_DISCREPANCY_RULES: DiscrepancyRules = { toleranceMinutes: 15 };

export interface AttendanceShape {
  businessDate: BusinessDate;
  firstClockInAt: Date | null;
  lastClockOutAt: Date | null;
  breaks: readonly BreakPeriod[];
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

function overlapMinutes(period: ActivePeriod, from: Date, to: Date): number {
  const end = period.endedAt ?? period.startedAt;
  const start = Math.max(period.startedAt.getTime(), from.getTime());
  const finish = Math.min(end.getTime(), to.getTime());
  return finish <= start ? 0 : Math.round((finish - start) / 60_000);
}

/**
 * 打刻と PC の観測を突き合わせ、食い違いを列挙する。
 * 結果はあくまで確認のための材料であり、これをもって勤務時間を書き換えることはしない。
 */
export function detectDiscrepancies(
  attendance: AttendanceShape,
  observations: readonly SessionObservation[],
  rules: DiscrepancyRules = DEFAULT_DISCREPANCY_RULES,
): Discrepancy[] {
  const periods = toActivePeriods(observations);
  const tolerance = rules.toleranceMinutes;
  const discrepancies: Discrepancy[] = [];

  if (periods.length === 0) {
    if (attendance.firstClockInAt !== null && attendance.lastClockOutAt !== null) {
      const worked = minutesBetween(attendance.firstClockInAt, attendance.lastClockOutAt);
      if (worked > tolerance) {
        discrepancies.push({
          kind: 'attendance_without_pc_activity',
          minutes: worked,
          evidence: {
            from: attendance.firstClockInAt.toISOString(),
            to: attendance.lastClockOutAt.toISOString(),
            note: '打刻はあるが、PC の利用記録が無い',
          },
        });
      }
    }
    return discrepancies;
  }

  const firstStart = periods[0]?.startedAt ?? null;
  const lastEnd = periods.at(-1)?.endedAt ?? periods.at(-1)?.startedAt ?? null;

  if (attendance.firstClockInAt === null) {
    if (firstStart !== null && lastEnd !== null) {
      const active = minutesBetween(firstStart, lastEnd);
      discrepancies.push({
        kind: 'pc_active_without_attendance',
        minutes: active,
        evidence: {
          from: firstStart.toISOString(),
          to: lastEnd.toISOString(),
          note: 'PC の利用記録はあるが、出勤の打刻が無い',
        },
      });
    }
    return discrepancies;
  }

  if (firstStart !== null) {
    const before = minutesBetween(firstStart, attendance.firstClockInAt);
    if (before > tolerance) {
      discrepancies.push({
        kind: 'pc_active_before_clock_in',
        minutes: before,
        evidence: {
          from: firstStart.toISOString(),
          to: attendance.firstClockInAt.toISOString(),
          note: '出勤の打刻より前に PC が使われている',
        },
      });
    }
  }

  if (attendance.lastClockOutAt !== null && lastEnd !== null) {
    const after = minutesBetween(attendance.lastClockOutAt, lastEnd);
    if (after > tolerance) {
      discrepancies.push({
        kind: 'pc_active_after_clock_out',
        minutes: after,
        evidence: {
          from: attendance.lastClockOutAt.toISOString(),
          to: lastEnd.toISOString(),
          note: '退勤の打刻より後に PC が使われている',
        },
      });
    }
  }

  for (const period of attendance.breaks) {
    if (period.endedAt === null) continue;
    const active = periods.reduce(
      (total, activePeriod) =>
        total + overlapMinutes(activePeriod, period.startedAt, period.endedAt as Date),
      0,
    );
    if (active > tolerance) {
      discrepancies.push({
        kind: 'pc_active_during_break',
        minutes: active,
        evidence: {
          from: period.startedAt.toISOString(),
          to: period.endedAt.toISOString(),
          note: '休憩として記録された時間帯に PC が使われている',
        },
      });
    }
  }

  return discrepancies;
}
