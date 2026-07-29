/**
 * 打刻イベントと、そこから導かれる一日の状態。
 *
 * イベントは追記のみで、取り消しや修正も新しいイベントとして表現する。
 * ここでは「並んだイベントから今どういう状態か」を決める規則だけを持つ。
 */
import type { BusinessDate } from './business-date.js';

export const ATTENDANCE_EVENT_TYPES = [
  'clock_in',
  'clock_out',
  'break_start',
  'break_end',
] as const;

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
 * `not_started` 出勤前 / `working` 勤務中 / `on_break` 休憩中 / `finished` 退勤済み
 */
export type WorkDayState = 'not_started' | 'working' | 'on_break' | 'finished';

export type PunchRejection =
  | 'already_working'
  | 'not_working'
  | 'already_finished'
  | 'already_on_break'
  | 'not_on_break'
  | 'still_on_break';

export interface PunchDecision {
  accepted: boolean;
  nextState: WorkDayState;
  rejection?: PunchRejection;
}

function reject(state: WorkDayState, rejection: PunchRejection): PunchDecision {
  return { accepted: false, nextState: state, rejection };
}

/**
 * 現在の状態でその打刻を受け付けてよいかを判断する。
 *
 * 退勤後の再出勤は、同じ業務日のうちは受け付けない。
 * 休憩中の退勤も受け付けない。休憩終了を先に記録させ、休憩時間を欠落させないため。
 */
export function decidePunch(state: WorkDayState, eventType: AttendanceEventType): PunchDecision {
  switch (eventType) {
    case 'clock_in':
      if (state === 'not_started') return { accepted: true, nextState: 'working' };
      if (state === 'finished') return reject(state, 'already_finished');
      return reject(state, 'already_working');

    case 'clock_out':
      if (state === 'working') return { accepted: true, nextState: 'finished' };
      if (state === 'on_break') return reject(state, 'still_on_break');
      return reject(state, 'not_working');

    case 'break_start':
      if (state === 'working') return { accepted: true, nextState: 'on_break' };
      if (state === 'on_break') return reject(state, 'already_on_break');
      return reject(state, 'not_working');

    case 'break_end':
      if (state === 'on_break') return { accepted: true, nextState: 'working' };
      return reject(state, 'not_on_break');
  }
}

export interface BreakPeriod {
  startedAt: Date;
  /** まだ休憩中の場合は null。 */
  endedAt: Date | null;
}

export interface WorkDaySummary {
  businessDate: BusinessDate;
  state: WorkDayState;
  firstClockInAt: Date | null;
  lastClockOutAt: Date | null;
  breaks: BreakPeriod[];
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
  const breaks: BreakPeriod[] = [];

  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of ordered) {
    const decision = decidePunch(state, event.eventType);
    if (!decision.accepted) continue;
    state = decision.nextState;

    switch (event.eventType) {
      case 'clock_in':
        if (firstClockInAt === null) firstClockInAt = event.occurredAt;
        break;
      case 'clock_out':
        lastClockOutAt = event.occurredAt;
        break;
      case 'break_start':
        breaks.push({ startedAt: event.occurredAt, endedAt: null });
        break;
      case 'break_end': {
        const open = breaks[breaks.length - 1];
        if (open) open.endedAt = event.occurredAt;
        break;
      }
    }
  }

  return { businessDate, state, firstClockInAt, lastClockOutAt, breaks };
}

/**
 * IC カードのように操作が 1 種類しかない入力で、次に記録すべき打刻を決める。
 *
 * 出勤前なら出勤、勤務中なら退勤、休憩中なら休憩終了。
 * 休憩の開始は種別を選べる入力からのみ行う。カードのひと触りで
 * 休憩に入るのか退勤するのかを取り違えないようにするため。
 */
export function nextCardPunch(state: WorkDayState): AttendanceEventType | null {
  switch (state) {
    case 'not_started':
      return 'clock_in';
    case 'working':
      return 'clock_out';
    case 'on_break':
      return 'break_end';
    case 'finished':
      return null;
  }
}

/** 勤務が継続中（退勤していない）かどうか。日跨ぎ勤務の判定に使う。 */
export function isOpenWorkDay(state: WorkDayState): boolean {
  return state === 'working' || state === 'on_break';
}
