/**
 * API キーの「最後に使った時刻」を、いつ書き直すか。
 *
 * この値は、使われなくなったキーを見つけるためのものであり、秒単位の精度は要らない。
 * 要求のたびに書くと、読み取りだけの要求にも書き込みの待ち時間が乗り、
 * 同じキーを使う要求どうしが同じ行の更新で直列化する。
 *
 * セッションの延長（{@link shouldRenew}）と同じ考え方で、要否を判断してから書く。
 */

/** 既定の間隔。この時間より新しい記録があれば、書き直さない。 */
export const DEFAULT_API_KEY_USAGE_INTERVAL_MS = 60_000;

export function shouldRecordApiKeyUse(
  lastUsedAt: Date | null,
  now: Date,
  intervalMs: number = DEFAULT_API_KEY_USAGE_INTERVAL_MS,
): boolean {
  if (lastUsedAt === null) return true;
  // 時計が戻った場合も書き直す。未来の記録を残したままにしない。
  if (lastUsedAt.getTime() > now.getTime()) return true;
  return now.getTime() - lastUsedAt.getTime() >= intervalMs;
}
