/**
 * 休憩を二度引かないことを確かめる。
 *
 * 実績・固定・自動を単純に足すと、同じ時間を重ねて引く。
 * 12:00-13:00 が固定休憩の日に、その時間帯を打刻もしていれば 2 時間になる。
 * 実際に休んだのは 1 時間しかない。
 */
import { describe, expect, it } from 'vitest';
import { resolveBreaks, totalMinutes } from './breaks.js';

const HOUR = 60;

describe('実績と固定の重ね合わせ', () => {
  it('重なりを二度引かない', () => {
    const resolution = resolveBreaks({
      actual: [{ start: 12 * HOUR, end: 13 * HOUR }],
      fixed: [{ start: 12 * HOUR, end: 13 * HOUR }],
      automatic: [],
      workedMinutes: 8 * HOUR,
    });

    expect(totalMinutes(resolution.intervals)).toBe(60);
    expect(resolution.overlapped).toEqual([{ origin: 'fixed', start: 12 * HOUR, end: 13 * HOUR }]);
  });

  it('一部だけ重なる固定休憩は、はみ出した分を足す', () => {
    const resolution = resolveBreaks({
      actual: [{ start: 12 * HOUR, end: 12 * HOUR + 30 }],
      fixed: [{ start: 12 * HOUR, end: 13 * HOUR }],
      automatic: [],
      workedMinutes: 8 * HOUR,
    });

    // 12:00-13:00 が一続きになる。
    expect(resolution.intervals).toEqual([{ start: 12 * HOUR, end: 13 * HOUR }]);
    expect(totalMinutes(resolution.intervals)).toBe(60);
  });

  it('離れた固定休憩はそのまま足す', () => {
    const resolution = resolveBreaks({
      actual: [{ start: 12 * HOUR, end: 13 * HOUR }],
      fixed: [{ start: 15 * HOUR, end: 15 * HOUR + 15 }],
      automatic: [],
      workedMinutes: 8 * HOUR,
    });

    expect(totalMinutes(resolution.intervals)).toBe(75);
    expect(resolution.overlapped).toEqual([]);
  });

  it('隣り合う時間帯はつないで数える', () => {
    const resolution = resolveBreaks({
      actual: [
        { start: 12 * HOUR, end: 12 * HOUR + 30 },
        { start: 12 * HOUR + 30, end: 13 * HOUR },
      ],
      fixed: [],
      automatic: [],
      workedMinutes: 8 * HOUR,
    });

    expect(resolution.intervals).toEqual([{ start: 12 * HOUR, end: 13 * HOUR }]);
  });
});

describe('自動休憩', () => {
  it('閾値を超えていなければ足さない', () => {
    const resolution = resolveBreaks({
      actual: [],
      fixed: [],
      automatic: [{ thresholdMinutes: 6 * HOUR, additionalMinutes: 45 }],
      workedMinutes: 6 * HOUR,
    });

    expect(resolution.automaticMinutes).toBe(0);
  });

  it('境界の 1 分後から足す', () => {
    const resolution = resolveBreaks({
      actual: [],
      fixed: [],
      automatic: [{ thresholdMinutes: 6 * HOUR, additionalMinutes: 45 }],
      workedMinutes: 6 * HOUR + 1,
    });

    expect(resolution.automaticMinutes).toBe(45);
  });

  it('すでに引いた休憩を差し引いてから判断する', () => {
    // 在社 8 時間、実績休憩 1 時間。残りは 7 時間。
    const resolution = resolveBreaks({
      actual: [{ start: 12 * HOUR, end: 13 * HOUR }],
      fixed: [],
      automatic: [{ thresholdMinutes: 8 * HOUR, additionalMinutes: 60 }],
      workedMinutes: 8 * HOUR,
    });

    expect(resolution.automaticMinutes).toBe(0);
  });

  it('段階が複数あるときは、いちばん多く引く段階だけを採る', () => {
    const resolution = resolveBreaks({
      actual: [],
      fixed: [],
      automatic: [
        { thresholdMinutes: 6 * HOUR, additionalMinutes: 45 },
        { thresholdMinutes: 8 * HOUR, additionalMinutes: 60 },
      ],
      workedMinutes: 9 * HOUR,
    });

    // 45 + 60 にはしない。
    expect(resolution.automaticMinutes).toBe(60);
  });

  it('採用した休憩を根拠として残す', () => {
    const resolution = resolveBreaks({
      actual: [{ start: 12 * HOUR, end: 13 * HOUR }],
      fixed: [{ start: 15 * HOUR, end: 15 * HOUR + 15 }],
      automatic: [{ thresholdMinutes: 4 * HOUR, additionalMinutes: 30 }],
      workedMinutes: 9 * HOUR,
    });

    expect(resolution.adopted.map((entry) => entry.origin)).toEqual([
      'actual',
      'fixed',
      'automatic',
    ]);
  });
});
