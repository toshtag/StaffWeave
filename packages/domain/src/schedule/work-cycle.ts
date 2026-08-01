/**
 * 勤務周期。
 *
 * 「週 5 日勤務」「土日休み」を前提にしない。
 * 長さの決まった並びを繰り返す形にすることで、週休 3 日も、2 日勤務 2 日休みも、
 * 10 日周期のような変則的な回し方も、同じ仕組みで表せるようにする。
 *
 * 7 日周期を使えば曜日固定の運用にもなるが、それはあくまで設定であって前提ではない。
 */
import type { BusinessDate } from '../attendance/business-date.js';
import type { DayType } from '../attendance/calculation.js';

export interface WorkCycleDay {
  /** 周期の中の位置。0 から `cycleLength - 1`。 */
  position: number;
  dayType: DayType;
  /** 勤務日のとき適用する勤務パターン。休日なら null。 */
  workPatternId: string | null;
}

export interface WorkCycle {
  id: string;
  code: string;
  name: string;
  /** 周期の長さ（日数）。7 なら週単位、4 なら 2 勤 2 休のような回し方になる。 */
  cycleLength: number;
  days: readonly WorkCycleDay[];
}

export interface WorkCycleAssignment {
  workCycleId: string;
  /** 周期の位置 0 に対応する業務日。 */
  anchorDate: BusinessDate;
  effectiveFrom: BusinessDate;
  /** 終わりが決まっていなければ null。 */
  effectiveTo: BusinessDate | null;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcDay(date: BusinessDate): number {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`業務日として解釈できません: ${date}`);
  }
  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
}

/** 起点日からの経過日数を周期の長さで割った位置。過去の日付でも負にならないようにする。 */
export function cyclePositionOf(
  anchorDate: BusinessDate,
  businessDate: BusinessDate,
  cycleLength: number,
): number {
  if (cycleLength <= 0) throw new Error('周期の長さは 1 以上にしてください');
  const difference = toUtcDay(businessDate) - toUtcDay(anchorDate);
  return ((difference % cycleLength) + cycleLength) % cycleLength;
}

/**
 * 有効期間から、その業務日に適用する割当を選ぶ。
 *
 * 同じ従業員の期間が重ならないことは DB の制約で決めている。
 * それでもここでは開始日が並んだ場合の順序を固定し、渡された順序で結果が変わらないようにする。
 * 勤務予定は同じ入力から常に同じ結果になる必要があるため。
 */
export function selectAssignment(
  assignments: readonly WorkCycleAssignment[],
  businessDate: BusinessDate,
): WorkCycleAssignment | null {
  const applicable = assignments.filter(
    (assignment) =>
      assignment.effectiveFrom <= businessDate &&
      (assignment.effectiveTo === null || businessDate <= assignment.effectiveTo),
  );
  if (applicable.length === 0) return null;

  return applicable.reduce((selected, assignment) =>
    isPreferredAssignment(assignment, selected) ? assignment : selected,
  );
}

/** 開始日が後のものを採る。並んだ場合は周期の識別子で決め、選択が順序に左右されないようにする。 */
function isPreferredAssignment(
  candidate: WorkCycleAssignment,
  selected: WorkCycleAssignment,
): boolean {
  if (candidate.effectiveFrom !== selected.effectiveFrom) {
    return candidate.effectiveFrom > selected.effectiveFrom;
  }
  return candidate.workCycleId > selected.workCycleId;
}

export interface ResolvedCycleDay {
  dayType: DayType;
  workPatternId: string | null;
  position: number;
}

/** 周期と割当から、その業務日の勤務種別を決める。 */
export function resolveCycleDay(
  cycle: WorkCycle,
  assignment: WorkCycleAssignment,
  businessDate: BusinessDate,
): ResolvedCycleDay | null {
  const position = cyclePositionOf(assignment.anchorDate, businessDate, cycle.cycleLength);
  const day = cycle.days.find((entry) => entry.position === position);
  if (!day) return null;
  return { dayType: day.dayType, workPatternId: day.workPatternId, position };
}

export type CycleProblem =
  | 'invalid_length'
  | 'position_out_of_range'
  | 'duplicate_position'
  | 'missing_position'
  | 'working_day_without_pattern';

/** 周期の定義が使える形になっているか。 */
export function validateWorkCycle(cycle: {
  cycleLength: number;
  days: readonly WorkCycleDay[];
}): CycleProblem[] {
  const problems: CycleProblem[] = [];
  if (!Number.isInteger(cycle.cycleLength) || cycle.cycleLength < 1 || cycle.cycleLength > 366) {
    return ['invalid_length'];
  }

  const seen = new Set<number>();
  for (const day of cycle.days) {
    if (day.position < 0 || day.position >= cycle.cycleLength) {
      if (!problems.includes('position_out_of_range')) problems.push('position_out_of_range');
      continue;
    }
    if (seen.has(day.position)) {
      if (!problems.includes('duplicate_position')) problems.push('duplicate_position');
    }
    seen.add(day.position);

    if (day.dayType === 'working_day' && day.workPatternId === null) {
      if (!problems.includes('working_day_without_pattern')) {
        problems.push('working_day_without_pattern');
      }
    }
  }

  if (seen.size !== cycle.cycleLength) problems.push('missing_position');
  return problems;
}
