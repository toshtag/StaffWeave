import { describe, expect, it } from 'vitest';
import { afterLoginFailure, isLoginBlocked } from './login-attempts.js';

const POLICY = { maxFailures: 3, windowMs: 60_000, blockMs: 300_000 };
const NOW = new Date('2026-04-01T00:00:00.000Z');

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

describe('isLoginBlocked', () => {
  it('記録が無ければ断らない', () => {
    expect(isLoginBlocked(null, NOW)).toBe(false);
  });

  it('期限が過ぎていれば断らない', () => {
    const state = { failures: 3, windowStartedAt: NOW, blockedUntil: at(-1) };
    expect(isLoginBlocked(state, NOW)).toBe(false);
  });

  it('期限の中なら断る', () => {
    const state = { failures: 3, windowStartedAt: NOW, blockedUntil: at(1) };
    expect(isLoginBlocked(state, NOW)).toBe(true);
  });
});

describe('afterLoginFailure', () => {
  it('最初の失敗から数え始める', () => {
    const state = afterLoginFailure(null, NOW, POLICY);
    expect(state).toEqual({ failures: 1, windowStartedAt: NOW, blockedUntil: null });
  });

  it('上限に達したら断る期限を置く', () => {
    let state = afterLoginFailure(null, NOW, POLICY);
    state = afterLoginFailure(state, at(1_000), POLICY);
    expect(state.blockedUntil).toBeNull();

    state = afterLoginFailure(state, at(2_000), POLICY);
    expect(state.failures).toBe(3);
    expect(state.blockedUntil).toEqual(new Date(at(2_000).getTime() + POLICY.blockMs));
  });

  it('窓が過ぎていたら数え直す', () => {
    const old = { failures: 2, windowStartedAt: NOW, blockedUntil: null };
    const state = afterLoginFailure(old, at(POLICY.windowMs), POLICY);

    expect(state.failures).toBe(1);
    expect(state.windowStartedAt).toEqual(at(POLICY.windowMs));
  });

  it('断っている最中の失敗で期限を延ばさない', () => {
    // 延ばすと、断られていることに気付かずに送り続ける利用者が永久に入れなくなる。
    const blocked = { failures: 3, windowStartedAt: NOW, blockedUntil: at(POLICY.blockMs) };
    const state = afterLoginFailure(blocked, at(1_000), POLICY);

    expect(state.blockedUntil).toEqual(new Date(at(1_000).getTime() + POLICY.blockMs));
    expect(state.failures).toBe(4);
  });
});
