import { describe, expect, it } from 'vitest';
import type { AttendanceEvent, AttendanceEventType } from './events.js';
import { decidePunch, isOpenWorkDay, nextCardPunch, summarizeWorkDay } from './events.js';

describe('decidePunch', () => {
  it('出勤前の出勤は受け付ける', () => {
    expect(decidePunch('not_started', 'clock_in')).toEqual({
      accepted: true,
      nextState: 'working',
    });
  });

  it('勤務中の重複した出勤は受け付けない', () => {
    expect(decidePunch('working', 'clock_in')).toEqual({
      accepted: false,
      nextState: 'working',
      rejection: 'already_working',
    });
  });

  it('出勤前の退勤は受け付けない', () => {
    expect(decidePunch('not_started', 'clock_out').rejection).toBe('not_working');
  });

  it('勤務中の退勤は受け付ける', () => {
    expect(decidePunch('working', 'clock_out')).toEqual({
      accepted: true,
      nextState: 'finished',
    });
  });

  it('退勤後の再出勤を受け付ける', () => {
    // 中抜け、分割シフト、呼び出し勤務は同じ業務日に出退勤を繰り返す。
    expect(decidePunch('finished', 'clock_in')).toEqual({ accepted: true, nextState: 'working' });
  });

  it('退勤後の重複した退勤は受け付けない', () => {
    expect(decidePunch('finished', 'clock_out').rejection).toBe('not_working');
  });

  it('勤務中の休憩開始は受け付ける', () => {
    expect(decidePunch('working', 'break_start')).toEqual({
      accepted: true,
      nextState: 'on_break',
    });
  });

  it('休憩中の休憩開始は受け付けない', () => {
    expect(decidePunch('on_break', 'break_start').rejection).toBe('already_on_break');
  });

  it('出勤前の休憩開始は受け付けない', () => {
    expect(decidePunch('not_started', 'break_start').rejection).toBe('not_working');
  });

  it('休憩中の休憩終了は受け付ける', () => {
    expect(decidePunch('on_break', 'break_end')).toEqual({ accepted: true, nextState: 'working' });
  });

  it('休憩中でない休憩終了は受け付けない', () => {
    expect(decidePunch('working', 'break_end').rejection).toBe('not_on_break');
  });

  it('休憩中の退勤は受け付けず、先に休憩終了を求める', () => {
    expect(decidePunch('on_break', 'clock_out').rejection).toBe('still_on_break');
  });
});

describe('isOpenWorkDay', () => {
  it('勤務中と休憩中は継続中とみなす', () => {
    expect(isOpenWorkDay('working')).toBe(true);
    expect(isOpenWorkDay('on_break')).toBe(true);
    expect(isOpenWorkDay('not_started')).toBe(false);
    expect(isOpenWorkDay('finished')).toBe(false);
  });
});

describe('summarizeWorkDay', () => {
  const at = (time: string) => new Date(`2026-04-01T${time}:00.000Z`);

  it('イベントが無ければ出勤前', () => {
    expect(summarizeWorkDay('2026-04-01', [])).toEqual({
      businessDate: '2026-04-01',
      state: 'not_started',
      firstClockInAt: null,
      lastClockOutAt: null,
      sessions: [],
      breaks: [],
    });
  });

  it('出勤のみなら勤務中', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      { eventType: 'clock_in', occurredAt: at('00:00') },
    ]);
    expect(summary.state).toBe('working');
    expect(summary.firstClockInAt).toEqual(at('00:00'));
  });

  it('出勤と退勤で退勤済みになる', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      { eventType: 'clock_in', occurredAt: at('00:00') },
      { eventType: 'clock_out', occurredAt: at('09:00') },
    ]);
    expect(summary.state).toBe('finished');
    expect(summary.firstClockInAt).toEqual(at('00:00'));
    expect(summary.lastClockOutAt).toEqual(at('09:00'));
  });

  it('順序が入れ替わっていても発生時刻で並べ直す', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      { eventType: 'clock_out', occurredAt: at('09:00') },
      { eventType: 'clock_in', occurredAt: at('00:00') },
    ]);
    expect(summary.state).toBe('finished');
  });

  it('休憩の開始と終了を区間として取り出す', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      { eventType: 'clock_in', occurredAt: at('00:00') },
      { eventType: 'break_start', occurredAt: at('03:00') },
      { eventType: 'break_end', occurredAt: at('04:00') },
      { eventType: 'break_start', occurredAt: at('06:00') },
      { eventType: 'break_end', occurredAt: at('06:15') },
      { eventType: 'clock_out', occurredAt: at('09:00') },
    ]);

    expect(summary.state).toBe('finished');
    expect(summary.breaks).toEqual([
      { startedAt: at('03:00'), endedAt: at('04:00') },
      { startedAt: at('06:00'), endedAt: at('06:15') },
    ]);
  });

  it('休憩中は終了時刻が未確定のまま残る', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      { eventType: 'clock_in', occurredAt: at('00:00') },
      { eventType: 'break_start', occurredAt: at('03:00') },
    ]);

    expect(summary.state).toBe('on_break');
    expect(summary.breaks).toEqual([{ startedAt: at('03:00'), endedAt: null }]);
  });

  it('受け付けられない並びのイベントは状態を進めない', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      { eventType: 'clock_in', occurredAt: at('00:00') },
      { eventType: 'clock_in', occurredAt: at('01:00') },
      { eventType: 'clock_out', occurredAt: at('09:00') },
    ]);
    expect(summary.state).toBe('finished');
    expect(summary.firstClockInAt).toEqual(at('00:00'));
  });
});

describe('複数の勤務区間', () => {
  const at = (time: string) => new Date(`2026-04-01T${time}:00.000Z`);
  const event = (eventType: AttendanceEventType, time: string): AttendanceEvent => ({
    eventType,
    occurredAt: at(time),
  });

  it('出退勤を繰り返した分だけ区間を持つ', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      event('clock_in', '09:00'),
      event('clock_out', '12:00'),
      event('clock_in', '15:00'),
      event('clock_out', '18:00'),
    ]);

    expect(summary.state).toBe('finished');
    expect(summary.sessions).toEqual([
      { startedAt: at('09:00'), endedAt: at('12:00') },
      { startedAt: at('15:00'), endedAt: at('18:00') },
    ]);
    // 最初と最後は、これまでどおり日全体の端を指す。
    expect(summary.firstClockInAt).toEqual(at('09:00'));
    expect(summary.lastClockOutAt).toEqual(at('18:00'));
  });

  it('中抜けから戻って退勤していなければ、最後の区間が開いたまま', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      event('clock_in', '09:00'),
      event('clock_out', '12:00'),
      event('clock_in', '15:00'),
    ]);

    expect(summary.state).toBe('working');
    expect(summary.sessions).toEqual([
      { startedAt: at('09:00'), endedAt: at('12:00') },
      { startedAt: at('15:00'), endedAt: null },
    ]);
  });

  it('休憩は区間をまたがず、そのままの並びで残る', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      event('clock_in', '09:00'),
      event('break_start', '10:00'),
      event('break_end', '10:30'),
      event('clock_out', '12:00'),
      event('clock_in', '15:00'),
      event('clock_out', '18:00'),
    ]);

    expect(summary.sessions).toHaveLength(2);
    expect(summary.breaks).toEqual([{ startedAt: at('10:00'), endedAt: at('10:30') }]);
  });

  it('休憩中の退勤は区間を閉じない', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      event('clock_in', '09:00'),
      event('break_start', '10:00'),
      event('clock_out', '11:00'),
    ]);

    expect(summary.state).toBe('on_break');
    expect(summary.sessions).toEqual([{ startedAt: at('09:00'), endedAt: null }]);
  });

  it('二重の出勤は受け付けず、区間も増えない', () => {
    const summary = summarizeWorkDay('2026-04-01', [
      event('clock_in', '09:00'),
      event('clock_in', '09:30'),
    ]);

    expect(summary.sessions).toEqual([{ startedAt: at('09:00'), endedAt: null }]);
  });
});

describe('nextCardPunch', () => {
  it('状態から次の打刻を一意に決める', () => {
    expect(nextCardPunch('not_started')).toBe('clock_in');
    expect(nextCardPunch('working')).toBe('clock_out');
    expect(nextCardPunch('on_break')).toBe('break_end');
  });

  it('退勤済みからは再出勤へ進む', () => {
    expect(nextCardPunch('finished')).toBe('clock_in');
  });
});
