import { describe, expect, it } from 'vitest';
import { decidePunch, isOpenWorkDay, summarizeWorkDay } from './events.js';

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

  it('退勤後の再出勤は同じ業務日では受け付けない', () => {
    expect(decidePunch('finished', 'clock_in').rejection).toBe('already_finished');
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
