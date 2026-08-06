import { describe, expect, it } from 'vitest';
import {
  addDaysToBusinessDate,
  businessDateOf,
  compareBusinessDates,
  isBusinessDate,
} from './business-date.js';

describe('businessDateOf', () => {
  it('タイムゾーンに従って業務日を決める', () => {
    // UTC 2026-04-01T20:00 は Asia/Tokyo では翌日 05:00。
    const instant = new Date('2026-04-01T20:00:00.000Z');
    expect(businessDateOf(instant, 'Asia/Tokyo')).toBe('2026-04-02');
    expect(businessDateOf(instant, 'UTC')).toBe('2026-04-01');
  });

  it('業務日の開始時刻をずらすと深夜の打刻が前日に属する', () => {
    // Asia/Tokyo の 2026-04-02 02:00。開始 5:00 なら前日の業務日。
    const instant = new Date('2026-04-01T17:00:00.000Z');
    expect(businessDateOf(instant, 'Asia/Tokyo')).toBe('2026-04-02');
    expect(businessDateOf(instant, 'Asia/Tokyo', 5 * 60)).toBe('2026-04-01');
  });

  it('開始時刻以降の打刻は当日のままになる', () => {
    // Asia/Tokyo の 2026-04-02 06:00。
    const instant = new Date('2026-04-01T21:00:00.000Z');
    expect(businessDateOf(instant, 'Asia/Tokyo', 5 * 60)).toBe('2026-04-02');
  });

  it('夏時間のあるタイムゾーンでも暦日を返す', () => {
    // America/New_York は 2026-03-08 に夏時間へ移行する。
    expect(businessDateOf(new Date('2026-03-08T12:00:00.000Z'), 'America/New_York')).toBe(
      '2026-03-08',
    );
  });

  /**
   * 業務日は現地の時計で決める。
   *
   * 絶対時刻から開始分を引いてから日付にすると、オフセットが変わる日で 1 時間ずれる。
   * ずれるのは切り替えの当日だけなので、平常時のテストでは現れない。
   */
  describe('夏時間の切り替わる日', () => {
    // America/New_York は 2026-03-08 の現地 2:00 に 3:00 へ進む。
    it.each([
      // 現地 4:59。開始の 1 分前なので前日。
      ['2026-03-08T08:59:00.000Z', '2026-03-07'],
      // 現地 5:00。開始ちょうどなので当日。
      ['2026-03-08T09:00:00.000Z', '2026-03-08'],
      // 現地 5:30。当日。
      ['2026-03-08T09:30:00.000Z', '2026-03-08'],
    ])('春の切り替えで %s は %s に属する', (iso, expected) => {
      expect(businessDateOf(new Date(iso), 'America/New_York', 5 * 60)).toBe(expected);
    });

    // 2026-11-01 の現地 2:00 に 1:00 へ戻る。1:00 台は 2 回訪れる。
    it.each([
      // 現地 1:30。戻る前と戻ったあとで 2 回訪れるが、どちらも前日。
      ['2026-11-01T05:30:00.000Z', '2026-10-31'],
      ['2026-11-01T06:30:00.000Z', '2026-10-31'],
      // 現地 5:00（戻ったあと）。当日。
      ['2026-11-01T10:00:00.000Z', '2026-11-01'],
    ])('秋の切り替えで %s は %s に属する', (iso, expected) => {
      expect(businessDateOf(new Date(iso), 'America/New_York', 5 * 60)).toBe(expected);
    });

    // Australia/Lord_Howe は 30 分だけ動く。
    it('30 分だけ動くタイムゾーンでもずれない', () => {
      // 現地 2026-04-05 の切り替え後、現地 5:30。
      expect(
        businessDateOf(new Date('2026-04-04T19:00:00.000Z'), 'Australia/Lord_Howe', 5 * 60),
      ).toBe('2026-04-05');
    });

    // Pacific/Kiritimati は UTC+14。日付変更線の向こう側。
    it('日付変更線の向こう側でも現地の日付で決まる', () => {
      // 現地 2026-04-02 05:30。
      expect(
        businessDateOf(new Date('2026-04-01T15:30:00.000Z'), 'Pacific/Kiritimati', 5 * 60),
      ).toBe('2026-04-02');
      // 現地 2026-04-02 04:30 は前日の業務日。
      expect(
        businessDateOf(new Date('2026-04-01T14:30:00.000Z'), 'Pacific/Kiritimati', 5 * 60),
      ).toBe('2026-04-01');
    });
  });

  it('開始時刻の境界を 1 分単位で分ける', () => {
    // Asia/Tokyo の 2026-04-02 04:59 / 05:00 / 05:01。
    expect(businessDateOf(new Date('2026-04-01T19:59:00.000Z'), 'Asia/Tokyo', 5 * 60)).toBe(
      '2026-04-01',
    );
    expect(businessDateOf(new Date('2026-04-01T20:00:00.000Z'), 'Asia/Tokyo', 5 * 60)).toBe(
      '2026-04-02',
    );
    expect(businessDateOf(new Date('2026-04-01T20:01:00.000Z'), 'Asia/Tokyo', 5 * 60)).toBe(
      '2026-04-02',
    );
  });
});

describe('isBusinessDate', () => {
  it.each([
    ['2026-04-01', true],
    ['2026-02-29', false],
    ['2024-02-29', true],
    ['2026-13-01', false],
    ['2026-4-1', false],
    ['20260401', false],
  ])('%s は %s', (value, expected) => {
    expect(isBusinessDate(value)).toBe(expected);
  });
});

describe('addDaysToBusinessDate', () => {
  it('月をまたいで加算できる', () => {
    expect(addDaysToBusinessDate('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDaysToBusinessDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('compareBusinessDates', () => {
  it('前後関係を返す', () => {
    expect(compareBusinessDates('2026-04-01', '2026-04-02')).toBe(-1);
    expect(compareBusinessDates('2026-04-02', '2026-04-01')).toBe(1);
    expect(compareBusinessDates('2026-04-01', '2026-04-01')).toBe(0);
  });
});
