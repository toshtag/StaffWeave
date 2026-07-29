/**
 * 打刻の発生時刻に対する受け入れ範囲。
 *
 * 端末の時計はずれる。オフラインで溜めた打刻は後からまとめて届く。
 * その両方を受け入れつつ、任意の過去・未来を申告できないようにする。
 */

/** 未来方向の許容。端末とサーバーの時計差を吸収する。 */
export const FUTURE_TOLERANCE_MINUTES = 2;

/** 過去方向の許容。オフライン時に溜めた打刻の再送を受け入れる。 */
export const PAST_TOLERANCE_MINUTES = 24 * 60;

export type OccurredAtProblem = 'too_far_future' | 'too_far_past';

export function validateOccurredAt(occurredAt: Date, now: Date): OccurredAtProblem[] {
  const differenceMinutes = (occurredAt.getTime() - now.getTime()) / 60_000;
  if (differenceMinutes > FUTURE_TOLERANCE_MINUTES) return ['too_far_future'];
  if (-differenceMinutes > PAST_TOLERANCE_MINUTES) return ['too_far_past'];
  return [];
}
