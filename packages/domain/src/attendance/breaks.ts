/**
 * 休憩の決め方。
 *
 * 休憩には出どころが 3 つある。
 *
 *   実績  従業員が打刻した休憩
 *   固定  勤務区分が決めた時間帯。打刻が無くても引く
 *   自動  実労働が閾値を超えたときに足す分数
 *
 * 三つを足し合わせると、同じ時間を二度引くことがある。
 * 12:00-13:00 が固定休憩の日に、その時間帯を実績としても打刻していれば、
 * 単純に足すと 2 時間になる。実際に休んだのは 1 時間しかない。
 *
 * そこで、実績と固定は時間帯として重ね合わせ、重なった分は一度だけ数える。
 * 自動休憩は時間帯を持たないため、重ね合わせたあとの実労働に対して足りない分だけを足す。
 *
 * 採用した区間と、重なりで捨てた区間は計算根拠へ残す。
 * 何分引いたかだけでは、あとから検算できない。
 */

export interface MinuteInterval {
  start: number;
  end: number;
}

export type BreakOrigin = 'actual' | 'fixed' | 'automatic';

export interface ResolvedBreak {
  origin: BreakOrigin;
  start: number;
  end: number;
}

export interface AutoBreakRule {
  /** この分数を超えたときに適用する。 */
  thresholdMinutes: number;
  /** 足す休憩の分数。 */
  additionalMinutes: number;
}

export interface BreakResolution {
  /** 重なりを取り除いた休憩の時間帯。 */
  intervals: MinuteInterval[];
  /** 時間帯を持たない自動休憩の分数。 */
  automaticMinutes: number;
  /** 採用した区間。根拠として残す。 */
  adopted: ResolvedBreak[];
  /** 重なっていたため二度目を数えなかった区間。 */
  overlapped: ResolvedBreak[];
}

/** 時間帯を重ね合わせ、隣り合うものはつなぐ。 */
function merge(intervals: readonly MinuteInterval[]): MinuteInterval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  const merged: MinuteInterval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last === undefined || interval.start > last.end) {
      merged.push({ ...interval });
      continue;
    }
    last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

/** 重ね合わせた時間帯の合計。 */
export function totalMinutes(intervals: readonly MinuteInterval[]): number {
  return intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}

/** 時間帯が、すでにある時間帯へ完全に含まれるか。 */
function covered(interval: MinuteInterval, by: readonly MinuteInterval[]): boolean {
  return by.some((other) => other.start <= interval.start && other.end >= interval.end);
}

/**
 * 実績・固定・自動を突き合わせ、実際に引く休憩を決める。
 *
 * @param workedMinutes 休憩を引く前の実労働。自動休憩の判定に使う。
 */
export function resolveBreaks(input: {
  actual: readonly MinuteInterval[];
  fixed: readonly MinuteInterval[];
  automatic: readonly AutoBreakRule[];
  workedMinutes: number;
}): BreakResolution {
  const adopted: ResolvedBreak[] = [];
  const overlapped: ResolvedBreak[] = [];

  // 実績を先に採る。実際に打刻された時間は、設定より確かな記録として扱う。
  const accumulated: MinuteInterval[] = [];
  for (const interval of input.actual) {
    if (interval.end <= interval.start) continue;
    adopted.push({ origin: 'actual', ...interval });
    accumulated.push(interval);
  }

  let intervals = merge(accumulated);
  for (const interval of input.fixed) {
    if (interval.end <= interval.start) continue;
    if (covered(interval, intervals)) {
      overlapped.push({ origin: 'fixed', ...interval });
      continue;
    }
    adopted.push({ origin: 'fixed', ...interval });
    intervals = merge([...intervals, interval]);
  }

  // 自動休憩は、重ね合わせたあとの実労働に対して判断する。
  // 先に引いた分を無視すると、休んでいるのにさらに引くことになる。
  const remaining = Math.max(0, input.workedMinutes - totalMinutes(intervals));
  let automaticMinutes = 0;
  for (const rule of [...input.automatic].sort(
    (left, right) => left.thresholdMinutes - right.thresholdMinutes,
  )) {
    if (remaining <= rule.thresholdMinutes) continue;
    // 段階が複数あるときは、いちばん多く引く段階だけを採る。足し合わせない。
    automaticMinutes = Math.max(automaticMinutes, rule.additionalMinutes);
  }

  if (automaticMinutes > 0) {
    adopted.push({ origin: 'automatic', start: 0, end: automaticMinutes });
  }

  return { intervals, automaticMinutes, adopted, overlapped };
}
