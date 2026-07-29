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
