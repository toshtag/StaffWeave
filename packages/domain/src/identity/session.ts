/**
 * セッションの有効期間に関する規則。
 * 現在時刻は必ず引数で受け取り、この層で時計を参照しない。
 */

export const SESSION_LIFETIME_MINUTES = 12 * 60;

/** 残り時間がこの割合を下回ったら延長する。 */
const RENEWAL_THRESHOLD = 0.5;

export interface SessionPeriod {
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type SessionState = 'active' | 'expired' | 'revoked';

export function sessionStateAt(period: SessionPeriod, now: Date): SessionState {
  if (period.revokedAt !== null && period.revokedAt.getTime() <= now.getTime()) {
    return 'revoked';
  }
  if (period.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}

export function expiresAtFrom(issuedAt: Date, lifetimeMinutes = SESSION_LIFETIME_MINUTES): Date {
  return new Date(issuedAt.getTime() + lifetimeMinutes * 60_000);
}

/**
 * セッションを延長すべきかどうか。
 * 操作のたびに書き込むと負荷が増えるため、残り時間が半分を切ったときだけ延長する。
 */
export function shouldRenew(period: SessionPeriod, now: Date): boolean {
  if (sessionStateAt(period, now) !== 'active') return false;
  const total = period.expiresAt.getTime() - period.issuedAt.getTime();
  if (total <= 0) return false;
  const remaining = period.expiresAt.getTime() - now.getTime();
  return remaining / total < RENEWAL_THRESHOLD;
}
