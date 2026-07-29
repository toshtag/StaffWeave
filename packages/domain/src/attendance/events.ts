/**
 * 打刻イベントと、そこから導かれる一日の状態。
 *
 * イベントは追記のみで、取り消しや修正も新しいイベントとして表現する（P4 以降）。
 * ここでは「並んだイベントから今どういう状態か」を決める規則だけを持つ。
 */
import type { BusinessDate } from './business-date.js';

export const ATTENDANCE_EVENT_TYPES = ['clock_in', 'clock_out'] as const;

export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

export function isAttendanceEventType(value: string): value is AttendanceEventType {
  return (ATTENDANCE_EVENT_TYPES as readonly string[]).includes(value);
}

/** 打刻の入力元。どこから来た記録かを後から追えるようにする。 */
export const ATTENDANCE_SOURCES = ['web', 'mobile', 'device', 'correction'] as const;

export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export interface AttendanceEvent {
  eventType: AttendanceEventType;
  occurredAt: Date;
}

/**
 * 一日の勤務状態。
 * `not_started` 出勤前 / `working` 勤務中 / `finished` 退勤済み
 */
export type WorkDayState = 'not_started' | 'working' | 'finished';

export type PunchRejection = 'already_working' | 'not_working' | 'already_finished';

export interface PunchDecision {
  accepted: boolean;
  nextState: WorkDayState;
  rejection?: PunchRejection;
}

/**
 * 現在の状態でその打刻を受け付けてよいかを判断する。
 *
 * 退勤後の再出勤は、同じ業務日のうちは受け付けない。
 * 中抜けや複数回の勤務は休憩として扱う設計とし、ここでは単純な一往復だけを許す。
 */
export function decidePunch(state: WorkDayState, eventType: AttendanceEventType): PunchDecision {
  if (eventType === 'clock_in') {
    if (state === 'working')
      return { accepted: false, nextState: state, rejection: 'already_working' };
    if (state === 'finished')
      return { accepted: false, nextState: state, rejection: 'already_finished' };
    return { accepted: true, nextState: 'working' };
  }

  if (state === 'working') return { accepted: true, nextState: 'finished' };
  return { accepted: false, nextState: state, rejection: 'not_working' };
}

export interface WorkDaySummary {
  businessDate: BusinessDate;
  state: WorkDayState;
  firstClockInAt: Date | null;
  lastClockOutAt: Date | null;
}

/**
 * 発生時刻の昇順に並んだイベントから、その日の状態をたたみ込む。
 * 受け付けられない並びのイベントは、状態を進めずに読み飛ばす。
 */
export function summarizeWorkDay(
  businessDate: BusinessDate,
  events: readonly AttendanceEvent[],
): WorkDaySummary {
  let state: WorkDayState = 'not_started';
  let firstClockInAt: Date | null = null;
  let lastClockOutAt: Date | null = null;

  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of ordered) {
    const decision = decidePunch(state, event.eventType);
    if (!decision.accepted) continue;
    state = decision.nextState;
    if (event.eventType === 'clock_in' && firstClockInAt === null) {
      firstClockInAt = event.occurredAt;
    }
    if (event.eventType === 'clock_out') {
      lastClockOutAt = event.occurredAt;
    }
  }

  return { businessDate, state, firstClockInAt, lastClockOutAt };
}
