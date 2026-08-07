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

describe('法定の区分', () => {
  /**
   * 何時間で時間外になるかは事業者が決める。製品は既定値を持たない。
   * 設定が無いまま 0 を返すと、設定し忘れに気付けない。
   */
  it('1 日の閾値が未設定なら、法定の区分を計算しない', () => {
    const result = calculateWorkDay(
      input({ events: [event('clock_in', '09:00'), event('clock_out', '21:00')] }),
    );

    expect(result.legalOvertimeMinutes).toBeNull();
    expect(result.legalInsideOvertimeMinutes).toBeNull();
    expect(result.nightOvertimeMinutes).toBeNull();
    expect(result.basis.unconfigured).toContain('法定内・法定外の 1 日の閾値');
  });

  it('閾値を設定すると、法定内と法定外を分ける', () => {
    const result = calculateWorkDay(
      input({
        events: [event('clock_in', '09:00'), event('clock_out', '21:00')],
        rules: { ...DEFAULT_CALCULATION_RULES, dailyLegalMinutes: 8 * 60 },
      }),
    );

    // 12 時間働き、閾値は 8 時間。法定外は 4 時間。
    expect(result.workedMinutes).toBe(12 * 60);
    expect(result.legalOvertimeMinutes).toBe(4 * 60);
    // 所定は 09:00-18:00。所定外は 3 時間で、そのうち法定内は 0 分。
    expect(result.outsideScheduleMinutes).toBe(3 * 60);
    expect(result.legalInsideOvertimeMinutes).toBe(0);
    expect(result.basis.unconfigured).toEqual([]);
  });

  it('所定を超えても法定内に収まる分を分ける', () => {
    const result = calculateWorkDay(
      input({
        // 所定 09:00-18:00（休憩 60 分）。10 時間在社。
        events: [event('clock_in', '09:00'), event('clock_out', '19:00')],
        rules: { ...DEFAULT_CALCULATION_RULES, dailyLegalMinutes: 10 * 60 },
      }),
    );

    expect(result.workedMinutes).toBe(10 * 60);
    expect(result.legalOvertimeMinutes).toBe(0);
    // 所定の時間帯の外で働いた 1 時間は、法定内の時間外。
    expect(result.legalInsideOvertimeMinutes).toBe(60);
  });

  it('境界のちょうどでは法定外にしない', () => {
    const rules = { ...DEFAULT_CALCULATION_RULES, dailyLegalMinutes: 8 * 60 };

    const exact = calculateWorkDay(
      input({ events: [event('clock_in', '09:00'), event('clock_out', '17:00')], rules }),
    );
    const oneMore = calculateWorkDay(
      input({ events: [event('clock_in', '09:00'), event('clock_out', '17:01')], rules }),
    );

    expect(exact.legalOvertimeMinutes).toBe(0);
    expect(oneMore.legalOvertimeMinutes).toBe(1);
  });

  it('法定休日と法定外休日を分ける', () => {
    const events = [event('clock_in', '09:00'), event('clock_out', '13:00')];

    const legal = calculateWorkDay(
      input({ events, schedule: { ...dayShift, dayType: 'legal_holiday' } }),
    );
    const nonLegal = calculateWorkDay(
      input({ events, schedule: { ...dayShift, dayType: 'non_working_day' } }),
    );

    expect(legal.legalHolidayMinutes).toBe(4 * 60);
    expect(legal.nonLegalHolidayMinutes).toBe(0);
    expect(nonLegal.legalHolidayMinutes).toBe(0);
    expect(nonLegal.nonLegalHolidayMinutes).toBe(4 * 60);
  });

  it('深夜のうち法定時間外に当たる分を出す', () => {
    const result = calculateWorkDay(
      input({
        // 13:00 から翌 1:00 まで 12 時間。深夜帯は 22:00-翌 5:00。
        events: [event('clock_in', '13:00'), event('clock_out', '25:00')],
        rules: { ...DEFAULT_CALCULATION_RULES, dailyLegalMinutes: 8 * 60 },
      }),
    );

    expect(result.nightMinutes).toBe(3 * 60);
    // 法定外は後ろの 4 時間（21:00-25:00）。そのうち深夜は 22:00-25:00 の 3 時間。
    expect(result.legalOvertimeMinutes).toBe(4 * 60);
    expect(result.nightOvertimeMinutes).toBe(3 * 60);
  });
});

describe('遅刻・早退・所定の前後', () => {
  it('所定に対する遅れと早退を出す', () => {
    const result = calculateWorkDay(
      input({ events: [event('clock_in', '09:30'), event('clock_out', '17:00')] }),
    );

    expect(result.lateMinutes).toBe(30);
    expect(result.earlyLeaveMinutes).toBe(60);
  });

  it('所定より前と後に働いた分を出す', () => {
    const result = calculateWorkDay(
      input({ events: [event('clock_in', '08:00'), event('clock_out', '19:00')] }),
    );

    expect(result.beforeScheduleMinutes).toBe(60);
    expect(result.afterScheduleMinutes).toBe(60);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
  });
});

describe('勤務区分の休憩', () => {
  const category = {
    code: 'DAY',
    fixedBreaks: [{ startMinutes: 12 * 60, endMinutes: 13 * 60 }],
    autoBreaks: [],
    nightStartMinutes: null,
    nightEndMinutes: null,
    gapTreatment: 'non_working' as const,
    deemedMinutes: null,
    prescribedMinutes: null,
    countsAsWorkingDay: true,
  };

  it('固定休憩を、打刻が無くても引く', () => {
    const result = calculateWorkDay(
      input({ events: [event('clock_in', '09:00'), event('clock_out', '18:00')], category }),
    );

    expect(result.breakMinutes).toBe(60);
    expect(result.workedMinutes).toBe(8 * 60);
  });

  it('同じ時間帯を打刻していても二度引かない', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('break_start', '12:00'),
          event('break_end', '13:00'),
          event('clock_out', '18:00'),
        ],
        category,
      }),
    );

    expect(result.breakMinutes).toBe(60);
    expect(result.basis.breakOrigins).toContainEqual({
      origin: 'fixed',
      minutes: 60,
      adopted: false,
    });
  });

  it('自動休憩を実労働から引く', () => {
    const result = calculateWorkDay(
      input({
        events: [event('clock_in', '09:00'), event('clock_out', '18:00')],
        category: {
          ...category,
          fixedBreaks: [],
          autoBreaks: [{ thresholdMinutes: 6 * 60, additionalMinutes: 45 }],
        },
      }),
    );

    expect(result.breakMinutes).toBe(45);
    expect(result.workedMinutes).toBe(9 * 60 - 45);
  });

  it('中抜けを休憩として扱う設定では、区間の間を休憩へ入れる', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('clock_out', '12:00'),
          event('clock_in', '15:00'),
          event('clock_out', '18:00'),
        ],
        category: { ...category, fixedBreaks: [], gapTreatment: 'break' },
      }),
    );

    expect(result.workedMinutes).toBe(6 * 60);
    expect(result.breakMinutes).toBe(3 * 60);
  });

  it('深夜帯を勤務区分で上書きできる', () => {
    const result = calculateWorkDay(
      input({
        events: [event('clock_in', '18:00'), event('clock_out', '22:00')],
        category: {
          ...category,
          fixedBreaks: [],
          nightStartMinutes: 20 * 60,
          nightEndMinutes: 6 * 60,
        },
      }),
    );

    // 既定なら 0 分。上書きで 20:00-22:00 の 2 時間。
    expect(result.nightMinutes).toBe(2 * 60);
  });
});

describe('複数の勤務区間', () => {
  it('中抜けの時間は在社にも実労働にも入れない', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('clock_out', '12:00'),
          event('clock_in', '15:00'),
          event('clock_out', '18:00'),
        ],
      }),
    );

    // 09:00-12:00 と 15:00-18:00 で 6 時間。12:00-15:00 の 3 時間は数えない。
    expect(result.attendedMinutes).toBe(6 * 60);
    expect(result.workedMinutes).toBe(6 * 60);
    expect(result.breakMinutes).toBe(0);
  });

  it('区間ごとの休憩を、その区間から引く', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('break_start', '10:00'),
          event('break_end', '10:30'),
          event('clock_out', '12:00'),
          event('clock_in', '15:00'),
          event('clock_out', '18:00'),
        ],
      }),
    );

    expect(result.attendedMinutes).toBe(6 * 60);
    expect(result.breakMinutes).toBe(30);
    expect(result.workedMinutes).toBe(6 * 60 - 30);
  });

  it('区間ごとに所定内と所定外を分ける', () => {
    const result = calculateWorkDay(
      input({
        events: [
          // 所定は 09:00-18:00。前half は所定内、後half は所定外。
          event('clock_in', '07:00'),
          event('clock_out', '08:00'),
          event('clock_in', '10:00'),
          event('clock_out', '11:00'),
        ],
      }),
    );

    expect(result.withinScheduleMinutes).toBe(60);
    expect(result.outsideScheduleMinutes).toBe(60);
  });

  it('最後の区間が開いたままなら確定していないものとして扱う', () => {
    const result = calculateWorkDay(
      input({
        events: [
          event('clock_in', '09:00'),
          event('clock_out', '12:00'),
          event('clock_in', '15:00'),
        ],
      }),
    );

    expect(result.basis.incomplete).toBe(true);
    // 閉じた区間の 3 時間だけを在社として示す。
    expect(result.attendedMinutes).toBe(3 * 60);
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
