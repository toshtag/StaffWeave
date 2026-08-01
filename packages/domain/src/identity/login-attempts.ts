/**
 * ログインの失敗を数える規則。
 *
 * 判断だけをここへ置き、保存と時計は上の層が持つ。
 * 「何回で断るか」「いつ数え直すか」を実装ごとに書かないための共通の場所。
 */

export interface LoginAttemptPolicy {
  /** この回数を超えて失敗したら断る。 */
  maxFailures: number;
  /** 数え直すまでの時間。最後に数え始めてからこの時間が過ぎたら 0 から数える。 */
  windowMs: number;
  /** 断る時間。 */
  blockMs: number;
}

export interface LoginAttemptState {
  failures: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

/** いま受け付けを断っているか。 */
export function isLoginBlocked(state: LoginAttemptState | null, now: Date): boolean {
  if (state?.blockedUntil == null) return false;
  return state.blockedUntil.getTime() > now.getTime();
}

/**
 * 失敗を 1 回数えた後の状態。
 *
 * 窓が過ぎていれば数え直す。断っている最中の失敗では期限を延ばさない。
 * 延ばすと、断られていることに気付かずに送り続ける利用者が永久に入れなくなる。
 */
export function afterLoginFailure(
  state: LoginAttemptState | null,
  now: Date,
  policy: LoginAttemptPolicy,
): LoginAttemptState {
  const expired =
    state === null || now.getTime() - state.windowStartedAt.getTime() >= policy.windowMs;
  const failures = (expired ? 0 : state.failures) + 1;
  const windowStartedAt = expired ? now : state.windowStartedAt;

  if (failures < policy.maxFailures) {
    return { failures, windowStartedAt, blockedUntil: null };
  }
  return {
    failures,
    windowStartedAt,
    blockedUntil: new Date(now.getTime() + policy.blockMs),
  };
}
