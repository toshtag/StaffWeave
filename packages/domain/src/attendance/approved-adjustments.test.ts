import { describe, expect, it } from 'vitest';
import type { ApprovedAdjustments, CalculationInput, WorkSchedule } from './calculation.js';
import { calculateWorkDay, DEFAULT_CALCULATION_RULES, fingerprintSource } from './calculation.js';
import type { AttendanceEvent } from './events.js';
import { instantFromLocal } from './local-time.js';

/**
 * 承認しきった申請が、日次の計算へどう効くか。
 *
 * ここで確かめるのは「承認された分だけを認定する」ことと、
 * 「承認が無ければ認定しない」ことの両方。
 * 片方だけでは、常に認定する実装も常に認定しない実装も通ってしまう。
 */

const TOKYO = 'Asia/Tokyo';

function tokyo(time: string, date = '2026-04-01'): Date {
  const [hour = '0', minute = '0'] = time.split(':');
  return instantFromLocal(date, Number(hour) * 60 + Number(minute), TOKYO);
}

function event(eventType: AttendanceEvent['eventType'], time: string): AttendanceEvent {
  return { eventType, occurredAt: tokyo(time) };
}

const dayShift: WorkSchedule = {
  dayType: 'working_day',
  startAt: tokyo('09:00'),
  endAt: tokyo('18:00'),
  breakMinutes: 0,
};

const holiday: WorkSchedule = {
  dayType: 'non_working_day',
  startAt: null,
  endAt: null,
  breakMinutes: 0,
};

function input(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    businessDate: '2026-04-01',
    timeZone: TOKYO,
    events: [],
    schedule: dayShift,
    rules: DEFAULT_CALCULATION_RULES,
    ...overrides,
  };
}

/** 21:00 までの残業を承認した状態。 */
const overtimeUntil21: ApprovedAdjustments = {
  overtimeLimitMinutes: 21 * 60,
  holidayWorkApproved: false,
};

describe('残業の認定', () => {
  it('承認が無ければ、所定外はすべて認定の外に出る', () => {
    const result = calculateWorkDay(
      input({ events: [event('clock_in', '09:00'), event('clock_out', '22:00')] }),
    );

    expect(result.outsideScheduleMinutes).toBe(4 * 60);
    expect(result.recognizedOvertimeMinutes).toBe(0);
    expect(result.unapprovedOvertimeMinutes).toBe(4 * 60);
  });

  it('上限の時刻までを認定し、超えた分を分けて出す', () => {
    const result = calculateWorkDay(
      input({
        events: [event('clock_in', '09:00'), event('clock_out', '22:00')],
        approvals: overtimeUntil21,
      }),
    );

    expect(result.outsideScheduleMinutes).toBe(4 * 60);
    // 18:00–21:00 が認定、21:00–22:00 が超過。
    expect(result.recognizedOvertimeMinutes).toBe(3 * 60);
    expect(result.unapprovedOvertimeMinutes).toBe(60);
  });

  it('認定と超過を足すと所定外に一致する', () => {
    const result = calculateWorkDay(
      input({
        events: [event('clock_in', '08:00'), event('clock_out', '20:30')],
        approvals: overtimeUntil21,
      }),
    );

    expect(
      (result.recognizedOvertimeMinutes ?? 0) + (result.unapprovedOvertimeMinutes ?? 0),
    ).toBe(result.outsideScheduleMinutes);
  });

  it('所定始業より前の実労働は、終わりの上限では認定しない', () => {
    const result = calculateWorkDay(
      input({
        events: [event('clock_in', '07:00'), event('clock_out', '18:00')],
        approvals: overtimeUntil21,
      }),
    );

    expect(result.beforeScheduleMinutes).toBe(2 * 60);
    expect(result.recognizedOvertimeMinutes).toBe(0);
    expect(result.unapprovedOvertimeMinutes).toBe(2 * 60);
  });

  it('日をまたぐ上限（翌 1:00）でも、認定の範囲がずれない', () => {
    const result = calculateWorkDay(
      input({
        events: [
          { eventType: 'clock_in', occurredAt: tokyo('20:00') },
          { eventType: 'clock_out', occurredAt: tokyo('02:00', '2026-04-02') },
        ],
        // 業務日の現地 0 時から数えた分数。翌 1:00 は 25 時。
        approvals: { overtimeLimitMinutes: 25 * 60, holidayWorkApproved: false },
      }),
    );

    // 20:00–翌 1:00 が認定、翌 1:00–2:00 が超過。
    expect(result.recognizedOvertimeMinutes).toBe(5 * 60);
    expect(result.unapprovedOvertimeMinutes).toBe(60);
  });

  it('所定終業が決まっていないのに上限だけ承認されたら、認定を未設定として示す', () => {
    const result = calculateWorkDay(
      input({
        schedule: null,
        events: [event('clock_in', '09:00'), event('clock_out', '22:00')],
        approvals: overtimeUntil21,
      }),
    );

    expect(result.recognizedOvertimeMinutes).toBeNull();
    expect(result.unapprovedOvertimeMinutes).toBeNull();
    expect(result.basis.unconfigured).toContain('所定の時間帯（残業の認定に要る）');
  });

  it('所定も承認も無ければ、認定は 0 で未設定にはしない', () => {
    const result = calculateWorkDay(
      input({ schedule: null, events: [event('clock_in', '09:00'), event('clock_out', '18:00')] }),
    );

    expect(result.recognizedOvertimeMinutes).toBe(0);
    expect(result.basis.unconfigured).not.toContain('所定の時間帯（残業の認定に要る）');
  });
});

describe('休日出勤の認定', () => {
  const events = [event('clock_in', '10:00'), event('clock_out', '15:00')];

  it('承認が無ければ、休日労働はすべて未承認として出る', () => {
    const result = calculateWorkDay(input({ schedule: holiday, events }));

    expect(result.nonWorkingDayMinutes).toBe(5 * 60);
    expect(result.approvedHolidayMinutes).toBe(0);
    expect(result.unapprovedHolidayMinutes).toBe(5 * 60);
  });

  it('承認があれば、休日労働を承認済みとして出す', () => {
    const result = calculateWorkDay(
      input({
        schedule: holiday,
        events,
        approvals: { overtimeLimitMinutes: null, holidayWorkApproved: true },
      }),
    );

    expect(result.approvedHolidayMinutes).toBe(5 * 60);
    expect(result.unapprovedHolidayMinutes).toBe(0);
  });

  it('休日には残業の認定を行わない', () => {
    const result = calculateWorkDay(
      input({
        schedule: holiday,
        events,
        approvals: { overtimeLimitMinutes: 21 * 60, holidayWorkApproved: true },
      }),
    );

    expect(result.recognizedOvertimeMinutes).toBe(0);
    expect(result.unapprovedOvertimeMinutes).toBe(0);
  });

  it('働いていない休日は、どちらも 0 になる', () => {
    const result = calculateWorkDay(input({ schedule: holiday }));

    expect(result.approvedHolidayMinutes).toBe(0);
    expect(result.unapprovedHolidayMinutes).toBe(0);
  });
});

describe('入力の指紋', () => {
  const events = [event('clock_in', '09:00'), event('clock_out', '22:00')];

  it('承認の有無で変わる', () => {
    const before = fingerprintSource(input({ events }));
    const after = fingerprintSource(input({ events, approvals: overtimeUntil21 }));

    expect(after).not.toBe(before);
  });

  it('上限の時刻が変われば変わる', () => {
    const first = fingerprintSource(input({ events, approvals: overtimeUntil21 }));
    const second = fingerprintSource(
      input({ events, approvals: { overtimeLimitMinutes: 22 * 60, holidayWorkApproved: false } }),
    );

    expect(second).not.toBe(first);
  });

  it('休日出勤の承認が付けば変わる', () => {
    const first = fingerprintSource(input({ events }));
    const second = fingerprintSource(
      input({ events, approvals: { overtimeLimitMinutes: null, holidayWorkApproved: true } }),
    );

    expect(second).not.toBe(first);
  });

  it('承認を渡さない場合と、承認が無い場合は同じになる', () => {
    const omitted = fingerprintSource(input({ events }));
    const empty = fingerprintSource(
      input({ events, approvals: { overtimeLimitMinutes: null, holidayWorkApproved: false } }),
    );

    expect(empty).toBe(omitted);
  });
});
