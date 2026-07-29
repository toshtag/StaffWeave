import { describe, expect, it } from 'vitest';
import { expiresAtFrom, sessionStateAt, shouldRenew } from './session.js';

const issuedAt = new Date('2026-04-01T00:00:00.000Z');

describe('expiresAtFrom', () => {
  it('既定では 12 時間後に失効する', () => {
    expect(expiresAtFrom(issuedAt).toISOString()).toBe('2026-04-01T12:00:00.000Z');
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
});
