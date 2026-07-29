import { describe, expect, it } from 'vitest';
import type { AttendanceShape, SessionObservation } from './session-observations.js';
import { detectDiscrepancies, toActivePeriods } from './session-observations.js';

const at = (time: string) => new Date(`2026-04-01T${time}:00.000Z`);

function observation(
  observationType: SessionObservation['observationType'],
  time: string,
): SessionObservation {
  return { observationType, occurredAt: at(time) };
}

const attendance: AttendanceShape = {
  businessDate: '2026-04-01',
  firstClockInAt: at('09:00'),
  lastClockOutAt: at('18:00'),
  breaks: [{ startedAt: at('12:00'), endedAt: at('13:00') }],
};

describe('toActivePeriods', () => {
  it('ログインからログオフまでを 1 つの期間にする', () => {
    expect(
      toActivePeriods([observation('sign_in', '09:00'), observation('sign_out', '18:00')]),
    ).toEqual([{ startedAt: at('09:00'), endedAt: at('18:00') }]);
  });

  it('ロックと解除で期間が分かれる', () => {
    const periods = toActivePeriods([
      observation('sign_in', '09:00'),
      observation('lock', '12:00'),
      observation('unlock', '13:00'),
      observation('sign_out', '18:00'),
    ]);

    expect(periods).toEqual([
      { startedAt: at('09:00'), endedAt: at('12:00') },
      { startedAt: at('13:00'), endedAt: at('18:00') },
    ]);
  });

  it('重複した開始は読み飛ばす', () => {
    const periods = toActivePeriods([
      observation('sign_in', '09:00'),
      observation('unlock', '09:05'),
      observation('sign_out', '18:00'),
    ]);

    expect(periods).toHaveLength(1);
  });

  it('開始のない終了は読み飛ばす', () => {
    expect(toActivePeriods([observation('lock', '09:00')])).toEqual([]);
  });

  it('閉じていない期間は終わりが未確定のまま残る', () => {
    expect(toActivePeriods([observation('sign_in', '09:00')])).toEqual([
      { startedAt: at('09:00'), endedAt: null },
    ]);
  });

  it('順序が入れ替わっていても時刻で並べ直す', () => {
    const periods = toActivePeriods([
      observation('sign_out', '18:00'),
      observation('sign_in', '09:00'),
    ]);
    expect(periods).toEqual([{ startedAt: at('09:00'), endedAt: at('18:00') }]);
  });
});

describe('detectDiscrepancies', () => {
  it('打刻と PC の利用が一致していれば何も出ない', () => {
    const result = detectDiscrepancies(attendance, [
      observation('sign_in', '09:00'),
      observation('lock', '12:00'),
      observation('unlock', '13:00'),
      observation('sign_out', '18:00'),
    ]);

    expect(result).toEqual([]);
  });

  it('出勤前の利用を示す', () => {
    const result = detectDiscrepancies(attendance, [
      observation('sign_in', '08:00'),
      observation('sign_out', '18:00'),
    ]);

    const found = result.find((entry) => entry.kind === 'pc_active_before_clock_in');
    expect(found?.minutes).toBe(60);
    expect(found?.evidence.note).toContain('出勤の打刻より前');
  });

  it('退勤後の利用を示す', () => {
    const result = detectDiscrepancies(attendance, [
      observation('sign_in', '09:00'),
      observation('sign_out', '20:00'),
    ]);

    expect(result.find((entry) => entry.kind === 'pc_active_after_clock_out')?.minutes).toBe(120);
  });

  it('許容範囲内のずれは示さない', () => {
    const result = detectDiscrepancies(attendance, [
      observation('sign_in', '08:50'),
      observation('lock', '12:00'),
      observation('unlock', '13:00'),
      observation('sign_out', '18:10'),
    ]);

    expect(result).toEqual([]);
  });

  it('休憩中の利用を示す', () => {
    const result = detectDiscrepancies(attendance, [
      observation('sign_in', '09:00'),
      observation('sign_out', '18:00'),
    ]);

    const found = result.find((entry) => entry.kind === 'pc_active_during_break');
    expect(found?.minutes).toBe(60);
  });

  it('打刻が無いのに PC が使われている場合を示す', () => {
    const result = detectDiscrepancies(
      { businessDate: '2026-04-01', firstClockInAt: null, lastClockOutAt: null, breaks: [] },
      [observation('sign_in', '09:00'), observation('sign_out', '18:00')],
    );

    expect(result).toEqual([
      {
        kind: 'pc_active_without_attendance',
        minutes: 540,
        evidence: {
          from: at('09:00').toISOString(),
          to: at('18:00').toISOString(),
          note: 'PC の利用記録はあるが、出勤の打刻が無い',
        },
      },
    ]);
  });

  it('PC の記録が無い勤務を示す', () => {
    const result = detectDiscrepancies(attendance, []);

    expect(result[0]?.kind).toBe('attendance_without_pc_activity');
    expect(result[0]?.minutes).toBe(540);
  });

  it('許容範囲は設定で変えられる', () => {
    const result = detectDiscrepancies(
      attendance,
      [
        observation('sign_in', '08:50'),
        observation('lock', '12:00'),
        observation('unlock', '13:00'),
        observation('sign_out', '18:00'),
      ],
      { toleranceMinutes: 5 },
    );

    expect(result.some((entry) => entry.kind === 'pc_active_before_clock_in')).toBe(true);
  });
});
