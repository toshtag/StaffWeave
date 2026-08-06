/**
 * 再試行の間隔と、諦める条件を確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  isRetryable,
  type RetryPolicy,
  retryDelayMs,
  shouldAbandon,
} from './retry.js';

const policy: RetryPolicy = {
  initialDelayMs: 1000,
  multiplier: 2,
  maximumDelayMs: 10_000,
  maximumAttempts: 4,
};

describe('次に試すまでの間隔', () => {
  it('試すたびに広げる', () => {
    expect(retryDelayMs(policy, 1)).toBe(1000);
    expect(retryDelayMs(policy, 2)).toBe(2000);
    expect(retryDelayMs(policy, 3)).toBe(4000);
  });

  it('上限を超えて広げない', () => {
    expect(retryDelayMs(policy, 10)).toBe(10_000);
  });

  it('ずらすのは遅らせる方向だけ', () => {
    // 早める方向へずらすと、間隔の下限が崩れる。
    expect(retryDelayMs(policy, 1, 1)).toBeGreaterThan(retryDelayMs(policy, 1, 0));
    expect(retryDelayMs(policy, 1, 0)).toBe(1000);
  });

  it('同じ入力なら同じ答えを返す', () => {
    expect(retryDelayMs(policy, 3, 0.5)).toBe(retryDelayMs(policy, 3, 0.5));
  });
});

describe('諦める条件', () => {
  it('決めた回数に達したら諦める', () => {
    expect(shouldAbandon(policy, 3)).toBe(false);
    expect(shouldAbandon(policy, 4)).toBe(true);
  });

  it('既定の方針は、半日ぶんの間隔と 8 回で止まる', () => {
    expect(shouldAbandon(DEFAULT_RETRY_POLICY, 8)).toBe(true);
    expect(retryDelayMs(DEFAULT_RETRY_POLICY, 20)).toBeLessThanOrEqual(
      Math.round(DEFAULT_RETRY_POLICY.maximumDelayMs * 1.25),
    );
  });
});

describe('送り直す意味', () => {
  it('応答が返らなければ送り直す', () => {
    expect(isRetryable(null)).toBe(true);
  });

  it('相手側の失敗と混雑は送り直す', () => {
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(408)).toBe(true);
  });

  it('要求そのものを断られたなら送り直さない', () => {
    // 同じ要求を送り直しても、同じ答えしか返らない。
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
  });

  it('通ったものは送り直さない', () => {
    expect(isRetryable(200)).toBe(false);
    expect(isRetryable(204)).toBe(false);
  });
});
