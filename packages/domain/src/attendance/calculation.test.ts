import { describe, expect, it } from 'vitest';
import type { CalculationInput, WorkSchedule } from './calculation.js';
import { calculateWorkDay, DEFAULT_CALCULATION_RULES, fingerprintSource } from './calculation.js';
import type { AttendanceEvent } from './events.js';
import { instantFromLocal, localMinutesOfDay } from './local-time.js';

const TOKYO = 'Asia/Tokyo';

/** Asia/Tokyo の 2026-04-01 における現地時刻。 */
function tokyo(time: string): Date {
  const [hour = '0', minute = '0'] = time.split(':');
  return instantFromLocal('2026-04-01', Number(hour) * 60 + Number(minute), TOKYO);
}

function event(eventType: AttendanceEvent['eventType'], time: string): AttendanceEvent {
  return { eventType, occurredAt: tokyo(time) };
}

const dayShift: WorkSchedule = {
  dayType: 'working_day',
  startAt: tokyo('09:00'),
  endAt: tokyo('18:00'),
  breakMinutes: 60,
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

describe('calculateWorkDay', () => {
  it('打刻が無ければすべて 0 になる', () => {
    const result = calculateWorkDay(input());

    expect(result.attendedMinutes).toBe(0);
    expect(result.workedMinutes).toBe(0);
    expect(result.scheduledMinutes).toBe(8 * 60);
    expect(result.basis.incomplete).toBe(false);
  });

  it('休憩を除いた実労働を数える', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('break_start', '12:00'),
          event('break_end', '13:00'),
          event('clock_out', '18:00'),
        ],
      }),
    );

    expect(result.attendedMinutes).toBe(9 * 60);
    expect(result.breakMinutes).toBe(60);
    expect(result.workedMinutes).toBe(8 * 60);
    expect(result.withinScheduleMinutes).toBe(8 * 60);
    expect(result.outsideScheduleMinutes).toBe(0);
    expect(result.nightMinutes).toBe(0);
  });

  it('複数回の休憩をすべて差し引く', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('break_start', '12:00'),
          event('break_end', '13:00'),
          event('break_start', '15:00'),
          event('break_end', '15:15'),
          event('clock_out', '18:00'),
        ],
      }),
    );

    expect(result.breakMinutes).toBe(75);
    expect(result.workedMinutes).toBe(9 * 60 - 75);
  });

  it('所定の外で働いた時間を所定外として数える', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '08:00'),
          event('break_start', '12:00'),
          event('break_end', '13:00'),
          event('clock_out', '20:00'),
        ],
      }),
    );

    expect(result.workedMinutes).toBe(11 * 60);
    expect(result.withinScheduleMinutes).toBe(8 * 60);
    expect(result.outsideScheduleMinutes).toBe(3 * 60);
  });

  it('深夜帯の労働を数える', () => {
    const result = calculateWorkDay(
      input({
        schedule: { ...dayShift, startAt: tokyo('13:00'), endAt: tokyo('22:00') },
        events: [event('clock_in', '20:00'), event('clock_out', '25:00')],
      }),
    );

    // 20:00〜翌 1:00 のうち、22:00〜翌 1:00 の 3 時間が深夜帯。
    expect(result.workedMinutes).toBe(5 * 60);
    expect(result.nightMinutes).toBe(3 * 60);
  });

  it('日付をまたぐ勤務も一続きとして数える', () => {
    const result = calculateWorkDay(
      input({
        schedule: {
          dayType: 'working_day',
          startAt: tokyo('22:00'),
          endAt: tokyo('31:00'),
          breakMinutes: 60,
        },
        events: [
          event('clock_in', '22:00'),
          event('break_start', '26:00'),
          event('break_end', '27:00'),
          event('clock_out', '31:00'),
        ],
      }),
    );

    expect(result.attendedMinutes).toBe(9 * 60);
    expect(result.workedMinutes).toBe(8 * 60);
    // 22:00〜翌 5:00 のうち、休憩 2:00〜3:00 を除いた 6 時間。
    expect(result.nightMinutes).toBe(6 * 60);
  });

  it('休日の労働は休日労働として数え、所定労働は 0 になる', () => {
    const result = calculateWorkDay(
      input({
        schedule: { dayType: 'non_working_day', startAt: null, endAt: null, breakMinutes: 0 },
        events: [event('clock_in', '10:00'), event('clock_out', '15:00')],
      }),
    );

    expect(result.workedMinutes).toBe(5 * 60);
    expect(result.nonWorkingDayMinutes).toBe(5 * 60);
    expect(result.scheduledMinutes).toBe(0);
    expect(result.withinScheduleMinutes).toBe(0);
    expect(result.outsideScheduleMinutes).toBe(5 * 60);
  });

  it('予定が無い日は所定内が 0 になる', () => {
    const result = calculateWorkDay(
      input({
        schedule: null,
        events: [event('clock_in', '10:00'), event('clock_out', '15:00')],
      }),
    );

    expect(result.scheduledMinutes).toBe(0);
    expect(result.withinScheduleMinutes).toBe(0);
    expect(result.outsideScheduleMinutes).toBe(5 * 60);
  });

  it('退勤していない日は未確定として示す', () => {
    const result = calculateWorkDay(
      input({ events: [event('clock_in', '09:00'), event('break_start', '12:00')] }),
    );

    expect(result.basis.incomplete).toBe(true);
  });

  it('丸め単位を指定すると集計を丸める', () => {
    const result = calculateWorkDay(
      input({
        rules: { ...DEFAULT_CALCULATION_RULES, roundingMinutes: 15, roundingMode: 'down' },
        events: [event('clock_in', '09:00'), event('clock_out', '17:50')],
      }),
    );

    expect(result.workedMinutes).toBe(8 * 60 + 45);
  });

  it('同じ入力からは同じ結果になる', () => {
    const events = [
      event('clock_in', '09:00'),
      event('break_start', '12:00'),
      event('break_end', '13:00'),
      event('clock_out', '18:00'),
    ];

    const first = calculateWorkDay(input({ events }));
    const second = calculateWorkDay(input({ events: [...events].reverse() }));

    expect(first).toEqual(second);
  });

  it('計算根拠に区間と内訳が含まれる', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('break_start', '12:00'),
          event('break_end', '13:00'),
          event('clock_out', '18:00'),
        ],
      }),
    );

    expect(result.basis.ruleVersion).toBe('v1');
    expect(result.basis.timeZone).toBe(TOKYO);
    expect(result.basis.segments).toHaveLength(2);
    expect(result.basis.segments[0]?.kind).toBe('work');
    expect(result.basis.segments[1]?.kind).toBe('break');
    expect(result.basis.steps.find((step) => step.label === '実労働')?.minutes).toBe(8 * 60);
  });
});

describe('fingerprintSource', () => {
  it('打刻の順序が変わっても同じ文字列になる', () => {
    const events = [event('clock_in', '09:00'), event('clock_out', '18:00')];
    expect(fingerprintSource(input({ events }))).toBe(
      fingerprintSource(input({ events: [...events].reverse() })),
    );
  });

  it('打刻が変われば異なる文字列になる', () => {
    expect(fingerprintSource(input({ events: [event('clock_in', '09:00')] }))).not.toBe(
      fingerprintSource(input({ events: [event('clock_in', '09:01')] })),
    );
  });

  it('ルールが変われば異なる文字列になる', () => {
    expect(fingerprintSource(input())).not.toBe(
      fingerprintSource(input({ rules: { ...DEFAULT_CALCULATION_RULES, roundingMinutes: 15 } })),
    );
  });
});

describe('現地時間の変換', () => {
  it('現地の分を求められる', () => {
    expect(localMinutesOfDay(tokyo('09:30'), TOKYO)).toBe(9 * 60 + 30);
    expect(localMinutesOfDay(tokyo('00:00'), TOKYO)).toBe(0);
  });

  it('現地時刻から絶対時刻へ戻せる', () => {
    const instant = instantFromLocal('2026-04-01', 9 * 60, TOKYO);
    expect(instant.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('夏時間のあるタイムゾーンでも往復できる', () => {
    const instant = instantFromLocal('2026-07-01', 9 * 60, 'America/New_York');
    expect(localMinutesOfDay(instant, 'America/New_York')).toBe(9 * 60);
  });
});
