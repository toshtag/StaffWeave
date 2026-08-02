import { describe, expect, it } from 'vitest';
import {
  absoluteExpiresAtFrom,
  expiresAtFrom,
  renewedExpiresAt,
  sessionStateAt,
  shouldRenew,
} from './session.js';

const issuedAt = new Date('2026-04-01T00:00:00.000Z');

describe('expiresAtFrom', () => {
  it('既定では 12 時間後に失効する', () => {
    expect(expiresAtFrom(issuedAt).toISOString()).toBe('2026-04-01T12:00:00.000Z');
  });
});

describe('absoluteExpiresAtFrom', () => {
  it('既定では発行から 7 日後', () => {
    expect(absoluteExpiresAtFrom(issuedAt).toISOString()).toBe('2026-04-08T00:00:00.000Z');
  });
});

describe('sessionStateAt', () => {
  const period = { issuedAt, expiresAt: expiresAtFrom(issuedAt), revokedAt: null };

  it('有効期限内なら active', () => {
    expect(sessionStateAt(period, new Date('2026-04-01T06:00:00.000Z'))).toBe('active');
  });

  it('有効期限ちょうどは expired', () => {
    expect(sessionStateAt(period, new Date('2026-04-01T12:00:00.000Z'))).toBe('expired');
  });

  it('失効済みなら revoked が優先される', () => {
    expect(
      sessionStateAt(
        { ...period, revokedAt: new Date('2026-04-01T01:00:00.000Z') },
        new Date('2026-04-01T06:00:00.000Z'),
      ),
    ).toBe('revoked');
  });

  // 保存された期限が先でも、発行時刻の側で終わらせる。
  // 移行を待たずに、すでに発行済みのセッションへも上限が効く。
  it('保存された期限が絶対期限より先でも、絶対期限を過ぎていれば expired', () => {
    const stretched = {
      issuedAt,
      expiresAt: new Date('2026-05-01T00:00:00.000Z'),
      revokedAt: null,
    };

    expect(sessionStateAt(stretched, new Date('2026-04-07T23:00:00.000Z'))).toBe('active');
    expect(sessionStateAt(stretched, new Date('2026-04-08T00:00:00.000Z'))).toBe('expired');
  });
});

describe('renewedExpiresAt', () => {
  const period = { issuedAt, expiresAt: expiresAtFrom(issuedAt), revokedAt: null };

  it('絶対期限まで余裕があれば、現在時刻から 12 時間後', () => {
    expect(renewedExpiresAt(period, new Date('2026-04-01T07:00:00.000Z')).toISOString()).toBe(
      '2026-04-01T19:00:00.000Z',
    );
  });

  it('絶対期限を超える場合は絶対期限で止める', () => {
    expect(renewedExpiresAt(period, new Date('2026-04-07T18:00:00.000Z')).toISOString()).toBe(
      '2026-04-08T00:00:00.000Z',
    );
  });
});

describe('shouldRenew', () => {
  const period = { issuedAt, expiresAt: expiresAtFrom(issuedAt), revokedAt: null };

  it('残り時間が半分を超えていれば延長しない', () => {
    expect(shouldRenew(period, new Date('2026-04-01T05:00:00.000Z'))).toBe(false);
  });

  it('残り時間が半分を切ったら延長する', () => {
    expect(shouldRenew(period, new Date('2026-04-01T07:00:00.000Z'))).toBe(true);
  });

  it('失効済みのセッションは延長しない', () => {
    expect(
      shouldRenew(
        { ...period, revokedAt: new Date('2026-04-01T02:00:00.000Z') },
        new Date('2026-04-01T07:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('絶対期限へ張り付いた後は、書いても値が変わらないため延長しない', () => {
    const atCap = { issuedAt, expiresAt: absoluteExpiresAtFrom(issuedAt), revokedAt: null };

    expect(shouldRenew(atCap, new Date('2026-04-07T20:00:00.000Z'))).toBe(false);
  });

  // 判定の分母を保存された期間にすると、延長のたびに分母が伸び、
  // 発行から時間が経つほど延長が成立しやすくなる。
  it('発行から時間が経っても、延長する残り時間の条件は変わらない', () => {
    const late = { issuedAt, expiresAt: new Date('2026-04-05T12:00:00.000Z'), revokedAt: null };

    expect(shouldRenew(late, new Date('2026-04-05T05:00:00.000Z'))).toBe(false);
    expect(shouldRenew(late, new Date('2026-04-05T07:00:00.000Z'))).toBe(true);
  });

  // 期限の直前に必ず操作する利用者でも、発行から 7 日で終わる。
  it('延長を繰り返しても絶対期限を超えない', () => {
    let current = { issuedAt, expiresAt: expiresAtFrom(issuedAt), revokedAt: null };
    let last = current.expiresAt;

    for (let step = 0; step < 100; step += 1) {
      const at = new Date(current.expiresAt.getTime() - 60 * 60_000);
      if (sessionStateAt(current, at) !== 'active') break;
      if (!shouldRenew(current, at)) break;
      current = { ...current, expiresAt: renewedExpiresAt(current, at) };
      last = current.expiresAt;
    }

    expect(last.toISOString()).toBe('2026-04-08T00:00:00.000Z');
    expect(sessionStateAt(current, new Date('2026-04-08T00:00:00.000Z'))).toBe('expired');
  });
});
