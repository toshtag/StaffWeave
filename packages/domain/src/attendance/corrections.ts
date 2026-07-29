/**
 * 打刻の修正。
 *
 * 元の打刻は決して書き換えない。修正は「どのイベントをどう直すか」を表す新しいイベントとして
 * 追加し、有効な打刻の集合はそこから導く。こうすることで、
 * 「実際に打刻された事実」と「人が確定させた記録」を最後まで区別できる。
 */
import type { AttendanceEventType } from './events.js';

export const CORRECTION_ACTIONS = ['adjust', 'void', 'add'] as const;

/**
 * `adjust` 既存の打刻の種別や時刻を直す
 * `void`   既存の打刻を無効にする
 * `add`    記録されていなかった打刻を足す
 */
export type CorrectionAction = (typeof CORRECTION_ACTIONS)[number];

export function isCorrectionAction(value: string): value is CorrectionAction {
  return (CORRECTION_ACTIONS as readonly string[]).includes(value);
}

export interface CorrectableEvent {
  id: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
  /** 修正イベントであれば、その種別。元の打刻なら null。 */
  correctionAction: CorrectionAction | null;
  /** `adjust` / `void` が対象とする元イベントの ID。 */
  correctsEventId: string | null;
  /** 追記順。同じイベントへの修正が複数ある場合、後のものを採用する。 */
  recordedAt: Date;
}

export interface EffectiveEvent {
  /** 有効な打刻として採用されたイベントの ID。 */
  id: string;
  /** 元をたどったときの、最初に記録されたイベントの ID。 */
  originEventId: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
  /** 修正によって置き換えられた結果かどうか。 */
  corrected: boolean;
}

/**
 * 修正を適用した「有効な打刻」の集合を求める。
 *
 * 修正はさらに修正できる。連鎖は追記順にたどり、循環は無視する。
 */
export function resolveEffectiveEvents(records: readonly CorrectableEvent[]): EffectiveEvent[] {
  const byId = new Map(records.map((record) => [record.id, record]));

  // 同じイベントを対象とする修正が複数あれば、記録が新しいものを採用する。
  const correctionsByTarget = new Map<string, CorrectableEvent>();
  for (const record of records) {
    if (record.correctionAction === null) continue;
    if (record.correctionAction === 'add') continue;
    if (record.correctsEventId === null) continue;
    const current = correctionsByTarget.get(record.correctsEventId);
    if (!current || current.recordedAt.getTime() <= record.recordedAt.getTime()) {
      correctionsByTarget.set(record.correctsEventId, record);
    }
  }

  // 起点になるのは、他のイベントの修正結果として現れないイベント。
  const roots = records.filter(
    (record) => record.correctionAction === null || record.correctionAction === 'add',
  );

  const effective: EffectiveEvent[] = [];

  for (const root of roots) {
    let current = root;
    let corrected = false;
    const visited = new Set<string>([root.id]);

    for (;;) {
      const correction = correctionsByTarget.get(current.id);
      if (!correction || visited.has(correction.id)) break;
      visited.add(correction.id);
      corrected = true;
      if (correction.correctionAction === 'void') {
        current = correction;
        break;
      }
      current = correction;
    }

    if (current.correctionAction === 'void') continue;
    // 対象が存在しない修正は無視する（別の従業員や別日のイベントを指した場合）。
    if (current.correctsEventId !== null && !byId.has(current.correctsEventId)) continue;

    effective.push({
      id: current.id,
      originEventId: root.id,
      eventType: current.eventType,
      occurredAt: current.occurredAt,
      corrected,
    });
  }

  return effective.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
