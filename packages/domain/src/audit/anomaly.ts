/**
 * 異常の分類と判定基準。
 *
 * ここで扱うのは「疑わしい状態を見つけて根拠を添える」ところまで。
 * 見つかったものを不正と決めつけず、確認のための材料として提示する。
 * 完全な不正防止を保証するものではない。
 */
import type { AttendanceEventType } from '../attendance/events.js';

export const ANOMALY_KINDS = [
  /** 確定した後に打刻が記録された */
  'post_finalization_change',
  /** 一日の修正が多すぎる */
  'excessive_corrections',
  /** 端末の時計がサーバーと大きくずれている */
  'device_clock_skew',
  /** 端末の連番が飛んでいる */
  'sequence_gap',
  /** 短い間隔で同じ種別の打刻が並んでいる */
  'duplicate_event',
  /** 端末が送ってきたが受け付けられなかった */
  'rejected_device_event',
] as const;

export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

export type AnomalySeverity = 'info' | 'warning';

export const ANOMALY_SEVERITY: Record<AnomalyKind, AnomalySeverity> = {
  post_finalization_change: 'warning',
  excessive_corrections: 'warning',
  device_clock_skew: 'warning',
  sequence_gap: 'info',
  duplicate_event: 'info',
  rejected_device_event: 'info',
};

export const ANOMALY_LABELS: Record<AnomalyKind, string> = {
  post_finalization_change: '確定後に打刻が記録されました',
  excessive_corrections: '一日の修正が多すぎます',
  device_clock_skew: '端末の時計がサーバーと大きくずれています',
  sequence_gap: '端末の連番が飛んでいます',
  duplicate_event: '短い間隔で同じ種別の打刻が並んでいます',
  rejected_device_event: '端末からの打刻が受け付けられませんでした',
};

export interface AnomalyRules {
  /** 一日の修正がこの件数を超えたら知らせる。 */
  correctionThreshold: number;
  /** 端末時計のずれがこの秒数を超えたら知らせる。 */
  clockSkewSeconds: number;
  /** この分数以内に同じ種別の打刻が並んでいたら知らせる。 */
  duplicateWindowMinutes: number;
}

export const DEFAULT_ANOMALY_RULES: AnomalyRules = {
  correctionThreshold: 3,
  clockSkewSeconds: 120,
  duplicateWindowMinutes: 2,
};

export interface TimedEvent {
  id: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
}

export interface DuplicatePair {
  firstEventId: string;
  secondEventId: string;
  eventType: AttendanceEventType;
  minutesApart: number;
}

/**
 * 短い間隔で並んだ同じ種別の打刻を探す。
 *
 * 打刻の受け入れ規則では連続した同じ種別を弾くため、これが現れるのは
 * 修正で足された打刻や、業務日をまたいだ記録が混ざったときになる。
 */
export function findDuplicateEvents(
  events: readonly TimedEvent[],
  rules: AnomalyRules = DEFAULT_ANOMALY_RULES,
): DuplicatePair[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const pairs: DuplicatePair[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    if (previous.eventType !== current.eventType) continue;

    const minutesApart = Math.round(
      (current.occurredAt.getTime() - previous.occurredAt.getTime()) / 60_000,
    );
    if (minutesApart <= rules.duplicateWindowMinutes) {
      pairs.push({
        firstEventId: previous.id,
        secondEventId: current.id,
        eventType: current.eventType,
        minutesApart,
      });
    }
  }

  return pairs;
}

export function isExcessiveCorrections(
  count: number,
  rules: AnomalyRules = DEFAULT_ANOMALY_RULES,
): boolean {
  return count > rules.correctionThreshold;
}

export function isNotableSkew(
  skewSeconds: number,
  rules: AnomalyRules = DEFAULT_ANOMALY_RULES,
): boolean {
  return Math.abs(skewSeconds) > rules.clockSkewSeconds;
}
