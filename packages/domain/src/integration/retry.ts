/**
 * 送信の再試行。
 *
 * 送れなかった通知をその場で捨てると、受け取り側が数分止まっただけで落ちる。
 * 落ちたことは履歴を見ないと分からない。
 *
 * 間隔は試行のたびに広げる。広げないと、止まっている相手へ送り続けて復旧を妨げる。
 * 同じ間隔で揃うと、複数の送信先が同時に復旧したときに再送が一斉に走る。
 * 少しずつずらす（ジッター）ことで、山を崩す。
 *
 * 決めた回数を超えたら諦める。無限に試すと、送れない相手の行が滞留し、
 * 送れるはずの相手の通知まで遅れる。
 */

export interface RetryPolicy {
  /** 1 回目の失敗のあと、次に試すまでの間隔。 */
  initialDelayMs: number;
  /** 間隔を広げる倍率。 */
  multiplier: number;
  /** これ以上は広げない上限。 */
  maximumDelayMs: number;
  /** この回数だけ試して駄目なら諦める。 */
  maximumAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  initialDelayMs: 30_000,
  multiplier: 3,
  maximumDelayMs: 6 * 60 * 60 * 1000,
  maximumAttempts: 8,
};

/**
 * 次に試すまでの間隔。
 *
 * @param attempts これまでに試した回数（1 回目の失敗のあとなら 1）。
 * @param jitter 0 以上 1 未満の値。呼び出し側が渡す。
 *   ここで乱数を作らないのは、同じ入力で同じ答えを返せるようにするため。
 */
export function retryDelayMs(policy: RetryPolicy, attempts: number, jitter = 0): number {
  const raw = policy.initialDelayMs * policy.multiplier ** Math.max(0, attempts - 1);
  const capped = Math.min(raw, policy.maximumDelayMs);
  // ずらすのは遅らせる方向だけ。早める方向へずらすと、間隔の下限が崩れる。
  return Math.round(capped * (1 + Math.min(Math.max(jitter, 0), 1) * 0.25));
}

/** その回数で諦めるか。 */
export function shouldAbandon(policy: RetryPolicy, attempts: number): boolean {
  return attempts >= policy.maximumAttempts;
}

/**
 * 応答から、送り直す意味があるかを判断する。
 *
 * 相手が「その要求は受け取れない」と言っているものを送り直しても、同じ答えしか返らない。
 * 送り直して意味があるのは、相手の側の一時的な事情（混雑・停止・通信の失敗）だけ。
 */
export function isRetryable(statusCode: number | null): boolean {
  // 応答が返らなかった（通信の失敗・時間切れ）。相手が復旧すれば通る。
  if (statusCode === null) return true;
  // 混雑と、相手側の失敗。
  if (statusCode === 408 || statusCode === 429) return true;
  return statusCode >= 500;
}
