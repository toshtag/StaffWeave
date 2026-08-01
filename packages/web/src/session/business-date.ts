import type { SessionResponse } from '@staffweave/contracts';
import type { BusinessDate } from '@staffweave/domain';
import { addDaysToBusinessDate, businessDateOf } from '@staffweave/domain';

/**
 * 画面で使う業務日。
 *
 * 業務日はワークスペースの時間帯で決まり、閲覧者の端末や UTC とは無関係に定まる。
 * `toISOString()` から日付を切り出すと UTC の日付になり、
 * 日本時間の 0 時から 9 時のあいだは前日を「今日」として扱ってしまう。
 *
 * 判定そのものはドメインの `businessDateOf` を使い、画面では組み立てない。
 */
export function businessToday(session: SessionResponse, now: Date = new Date()): BusinessDate {
  return businessDateOf(now, session.workspace.timeZone);
}

/** 今日の業務日から指定した日数だけ遡る期間。日付の計算も業務日どうしで行う。 */
export function recentBusinessDateRange(
  session: SessionResponse,
  days: number,
  now: Date = new Date(),
): { from: BusinessDate; to: BusinessDate } {
  const to = businessToday(session, now);
  return { from: addDaysToBusinessDate(to, -days), to };
}
