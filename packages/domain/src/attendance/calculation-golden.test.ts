/**
 * 代表的な 1 日を並べ、出る数を丸ごと固定する。
 *
 * 個々の規則は calculation.test.ts が見ている。ここが見るのは、
 * 規則どうしを組み合わせたときに出る「最終的な数」。
 *
 * 分けて置くのは、直したつもりのない値が動いたことに気付くため。
 * ある規則を直すと、別の規則と重なる日の数が変わることがある。
 * 個別の検査は通ったまま、月末の合計だけが変わる。
 *
 * 期待値は手で書く。計算した結果を書き戻すと、
 * 「いまの実装が出す値」を固定するだけになり、誤りごと固まる。
 */
import { describe, expect, it } from 'vitest';
import {
  type CalculationInput,
  type CalculationResult,
  calculateWorkDay,
  DEFAULT_CALCULATION_RULES,
} from './calculation.js';

const TOKYO = 'Asia/Tokyo';

/** Asia/Tokyo の時刻を絶対時刻へ直す。読む側が時差を暗算しなくて済むようにする。 */
function at(businessDate: string, clock: string): Date {
  return new Date(`${businessDate}T${clock}:00+09:00`);
}

/** 法定の閾値を決めた規則。決めるまで法定の区分は出ない。 */
const WITH_LEGAL = {
  ...DEFAULT_CALCULATION_RULES,
  dailyLegalMinutes: 480,
  weeklyLegalMinutes: 2400,
};

interface Golden {
  name: string;
  input: CalculationInput;
  /** 見る値だけを書く。全部を書くと、関わりのない列の追加でここが落ちる。 */
  expected: Partial<CalculationResult>;
}

const GOLDEN: Golden[] = [
  {
    name: '9 時から 18 時、休憩 1 時間',
    input: {
      businessDate: '2026-04-01',
      timeZone: TOKYO,
      events: [
        { eventType: 'clock_in', occurredAt: at('2026-04-01', '09:00') },
        { eventType: 'break_start', occurredAt: at('2026-04-01', '12:00') },
        { eventType: 'break_end', occurredAt: at('2026-04-01', '13:00') },
        { eventType: 'clock_out', occurredAt: at('2026-04-01', '18:00') },
      ],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: {
      attendedMinutes: 540,
      breakMinutes: 60,
      workedMinutes: 480,
      nightMinutes: 0,
      // 8 時間ちょうど。法定の閾値を超えないため、法定時間外は出ない。
      legalOvertimeMinutes: 0,
      // 所定を決めていないため、働いた分はすべて「所定を超え、法定に収まる分」になる。
      legalInsideOvertimeMinutes: 480,
    },
  },
  {
    name: '9 時から 21 時、休憩 1 時間（法定時間外が出る）',
    input: {
      businessDate: '2026-04-02',
      timeZone: TOKYO,
      events: [
        { eventType: 'clock_in', occurredAt: at('2026-04-02', '09:00') },
        { eventType: 'break_start', occurredAt: at('2026-04-02', '12:00') },
        { eventType: 'break_end', occurredAt: at('2026-04-02', '13:00') },
        { eventType: 'clock_out', occurredAt: at('2026-04-02', '21:00') },
      ],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: {
      attendedMinutes: 720,
      breakMinutes: 60,
      workedMinutes: 660,
      // 11 時間のうち 8 時間を超えた 3 時間。
      legalOvertimeMinutes: 180,
      // 残りの 8 時間は、所定を超えて法定に収まる分。
      legalInsideOvertimeMinutes: 480,
      nightMinutes: 0,
    },
  },
  {
    name: '20 時から翌 2 時（深夜帯に入る）',
    input: {
      businessDate: '2026-04-03',
      timeZone: TOKYO,
      events: [
        { eventType: 'clock_in', occurredAt: at('2026-04-03', '20:00') },
        { eventType: 'clock_out', occurredAt: at('2026-04-04', '02:00') },
      ],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: {
      attendedMinutes: 360,
      workedMinutes: 360,
      // 22:00 から 02:00 までの 4 時間。
      nightMinutes: 240,
      legalOvertimeMinutes: 0,
    },
  },
  {
    name: '中抜けのある 1 日（2 区間）',
    input: {
      businessDate: '2026-04-06',
      timeZone: TOKYO,
      events: [
        { eventType: 'clock_in', occurredAt: at('2026-04-06', '09:00') },
        { eventType: 'clock_out', occurredAt: at('2026-04-06', '12:00') },
        { eventType: 'clock_in', occurredAt: at('2026-04-06', '15:00') },
        { eventType: 'clock_out', occurredAt: at('2026-04-06', '19:00') },
      ],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: {
      // 区間の間は在社にも実労働にも入れない。3 時間 + 4 時間。
      attendedMinutes: 420,
      workedMinutes: 420,
      breakMinutes: 0,
      legalOvertimeMinutes: 0,
    },
  },
  {
    name: '法定の閾値を決めていない日',
    input: {
      businessDate: '2026-04-07',
      timeZone: TOKYO,
      events: [
        { eventType: 'clock_in', occurredAt: at('2026-04-07', '09:00') },
        { eventType: 'clock_out', occurredAt: at('2026-04-07', '21:00') },
      ],
      schedule: null,
      rules: DEFAULT_CALCULATION_RULES,
    },
    expected: {
      workedMinutes: 720,
      // 0 ではなく未設定。計算していないことを、計算した 0 と混ぜない。
      legalOvertimeMinutes: null,
      legalInsideOvertimeMinutes: null,
    },
  },
  {
    name: '出勤したまま退勤していない日',
    input: {
      businessDate: '2026-04-08',
      timeZone: TOKYO,
      events: [{ eventType: 'clock_in', occurredAt: at('2026-04-08', '09:00') }],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: {
      // 閉じていない区間は、在社にも実労働にも数えない。
      attendedMinutes: 0,
      workedMinutes: 0,
    },
  },
  {
    name: '打刻の無い日',
    input: {
      businessDate: '2026-04-09',
      timeZone: TOKYO,
      events: [],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: { attendedMinutes: 0, workedMinutes: 0, breakMinutes: 0 },
  },
  {
    name: '夏時間の切り替わりを含む日（拠点が Asia/Tokyo なら影響しない）',
    input: {
      businessDate: '2026-03-08',
      timeZone: TOKYO,
      events: [
        { eventType: 'clock_in', occurredAt: new Date('2026-03-08T00:00:00.000Z') },
        { eventType: 'clock_out', occurredAt: new Date('2026-03-08T09:00:00.000Z') },
      ],
      schedule: null,
      rules: WITH_LEGAL,
    },
    expected: { attendedMinutes: 540, workedMinutes: 540 },
  },
];

describe('代表的な 1 日', () => {
  for (const golden of GOLDEN) {
    it(golden.name, () => {
      expect(calculateWorkDay(golden.input)).toMatchObject(golden.expected);
    });
  }

  it('同じ入力からは、いつも同じ数が出る', () => {
    const first = GOLDEN[0];
    if (first === undefined) throw new Error('代表の日がありません');

    expect(calculateWorkDay(first.input)).toEqual(calculateWorkDay(first.input));
  });
});
