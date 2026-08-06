/**
 * 打刻そのものの受け入れ範囲と、人が後から直す訂正の範囲を分けて確かめる。
 *
 * 同じ検証を両方へ当てていたため、前月の打刻漏れを締め前でも直せなかった。
 * 打刻の側を広げると、任意の過去を申告できてしまう。範囲を分けて、
 * 打刻は狭いまま、訂正だけを広げる。
 */
import { describe, expect, it } from 'vitest';
import {
  CORRECTION_PAST_TOLERANCE_MINUTES,
  PAST_TOLERANCE_MINUTES,
  validateCorrectionOccurredAt,
  validateOccurredAt,
} from './occurred-at.js';

const NOW = new Date('2026-04-15T09:00:00.000Z');

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function minutesAfter(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

describe('打刻の受け入れ範囲', () => {
  it('直前の時刻は受け入れる', () => {
    expect(validateOccurredAt(minutesBefore(1), NOW)).toEqual([]);
  });

  it('境界のちょうどは受け入れ、1 分でも前なら断る', () => {
    expect(validateOccurredAt(minutesBefore(PAST_TOLERANCE_MINUTES), NOW)).toEqual([]);
    expect(validateOccurredAt(minutesBefore(PAST_TOLERANCE_MINUTES + 1), NOW)).toEqual([
      'too_far_past',
    ]);
  });

  it('時計差を超える未来は断る', () => {
    expect(validateOccurredAt(minutesAfter(2), NOW)).toEqual([]);
    expect(validateOccurredAt(minutesAfter(3), NOW)).toEqual(['too_far_future']);
  });
});

describe('訂正の受け入れ範囲', () => {
  it('2 日前を受け入れる', () => {
    // 打刻の側では断られる範囲。
    const twoDaysAgo = minutesBefore(2 * 24 * 60);

    expect(validateOccurredAt(twoDaysAgo, NOW)).toEqual(['too_far_past']);
    expect(validateCorrectionOccurredAt(twoDaysAgo, NOW)).toEqual([]);
  });

  it('前月と年跨ぎを受け入れる', () => {
    expect(validateCorrectionOccurredAt(new Date('2026-03-20T09:00:00.000Z'), NOW)).toEqual([]);
    expect(validateCorrectionOccurredAt(new Date('2025-12-28T09:00:00.000Z'), NOW)).toEqual([]);
  });

  it('境界のちょうどは受け入れ、1 分でも前なら断る', () => {
    expect(
      validateCorrectionOccurredAt(minutesBefore(CORRECTION_PAST_TOLERANCE_MINUTES), NOW),
    ).toEqual([]);
    expect(
      validateCorrectionOccurredAt(minutesBefore(CORRECTION_PAST_TOLERANCE_MINUTES + 1), NOW),
    ).toEqual(['too_far_past']);
  });

  it('未来は打刻と同じだけしか許さない', () => {
    expect(validateCorrectionOccurredAt(minutesAfter(2), NOW)).toEqual([]);
    expect(validateCorrectionOccurredAt(minutesAfter(3), NOW)).toEqual(['too_far_future']);
  });
});
