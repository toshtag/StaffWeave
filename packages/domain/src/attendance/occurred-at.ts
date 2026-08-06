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

/**
 * 訂正が遡れる範囲。
 *
 * 人が後から直す訂正に、打刻の再送と同じ 24 時間を当てると、
 * 前月の打刻漏れも、月次確認で見つけた誤りも直せない。
 * 「過去の記録を理由付きで訂正できる」という製品の説明とも食い違う。
 *
 * 無制限にはしない。締め済みの期間はここより先で断るため、
 * 実際に通るのは締めていない範囲だけになる。
 * 400 日にすると、前月・前年度・年跨ぎが入り、
 * それより前は入力の誤りとして扱える。
 */
export const CORRECTION_PAST_TOLERANCE_MINUTES = 400 * 24 * 60;

export type OccurredAtProblem = 'too_far_future' | 'too_far_past';

function validate(occurredAt: Date, now: Date, pastToleranceMinutes: number): OccurredAtProblem[] {
  const differenceMinutes = (occurredAt.getTime() - now.getTime()) / 60_000;
  if (differenceMinutes > FUTURE_TOLERANCE_MINUTES) return ['too_far_future'];
  if (-differenceMinutes > pastToleranceMinutes) return ['too_far_past'];
  return [];
}

/** 打刻そのものの受け入れ範囲。オフラインの再送を見込む。 */
export function validateOccurredAt(occurredAt: Date, now: Date): OccurredAtProblem[] {
  return validate(occurredAt, now, PAST_TOLERANCE_MINUTES);
}

/**
 * 訂正で指定できる時刻の範囲。
 *
 * 未来は打刻と同じだけしか許さない。まだ起きていない勤務を先に書けてしまうと、
 * 訂正が予定の入力になる。過去だけを広げる。
 */
export function validateCorrectionOccurredAt(occurredAt: Date, now: Date): OccurredAtProblem[] {
  return validate(occurredAt, now, CORRECTION_PAST_TOLERANCE_MINUTES);
}
