/**
 * セッションの有効期間に関する規則。
 * 現在時刻は必ず引数で受け取り、この層で時計を参照しない。
 *
 * 期限は 2 つある。
 *
 * - アイドル期限: 最後に使われた時刻からの猶予。操作が続くかぎり延びる。
 * - 絶対期限: 発行時刻からの上限。操作が続いても延びない。
 *
 * アイドル期限だけでは、盗まれたトークンを使い続けるかぎりセッションが終わらない。
 * 絶対期限は、利用が続いていることを理由に延長しない値として置く。
 */

/** 最後に使われてから、この時間だけ有効。操作のたびに延びる。 */
export const SESSION_IDLE_LIFETIME_MINUTES = 12 * 60;

/** 発行時刻から、この時間を超えたセッションは、使われていても終わる。 */
export const SESSION_ABSOLUTE_LIFETIME_MINUTES = 7 * 24 * 60;

/** 残りがアイドル期限のこの割合を下回ったら延長する。 */
const RENEWAL_THRESHOLD = 0.5;

export interface SessionPeriod {
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type SessionState = 'active' | 'expired' | 'revoked';

export function expiresAtFrom(
  issuedAt: Date,
  lifetimeMinutes = SESSION_IDLE_LIFETIME_MINUTES,
): Date {
  return new Date(issuedAt.getTime() + lifetimeMinutes * 60_000);
}

/** 発行時刻から決まる、そのセッションが終わる時刻。延長では動かない。 */
export function absoluteExpiresAtFrom(
  issuedAt: Date,
  lifetimeMinutes = SESSION_ABSOLUTE_LIFETIME_MINUTES,
): Date {
  return new Date(issuedAt.getTime() + lifetimeMinutes * 60_000);
}

export function sessionStateAt(period: SessionPeriod, now: Date): SessionState {
  if (period.revokedAt !== null && period.revokedAt.getTime() <= now.getTime()) {
    return 'revoked';
  }
  if (period.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  // 保存された期限が絶対期限より先でも、発行時刻の側で終わらせる。
  // 既に発行済みのセッションにも、移行なしで上限が効く。
  if (absoluteExpiresAtFrom(period.issuedAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}

/**
 * 延長したときの新しい期限。
 * 絶対期限を超えないため、発行から時間が経つほど延びる幅は小さくなる。
 */
export function renewedExpiresAt(period: SessionPeriod, now: Date): Date {
  const idle = expiresAtFrom(now);
  const absolute = absoluteExpiresAtFrom(period.issuedAt);
  return idle.getTime() < absolute.getTime() ? idle : absolute;
}

/**
 * セッションを延長すべきかどうか。
 *
 * 操作のたびに書き込むと負荷が増えるため、残りがアイドル期限の半分を切ったときだけ延長する。
 * 判定の分母には保存された期間ではなくアイドル期限を使う。
 * 保存された期間を使うと、延長のたびに分母が伸び、時間が経つほど延長が成立しやすくなる。
 */
export function shouldRenew(period: SessionPeriod, now: Date): boolean {
  if (sessionStateAt(period, now) !== 'active') return false;
  const remaining = period.expiresAt.getTime() - now.getTime();
  if (remaining >= SESSION_IDLE_LIFETIME_MINUTES * 60_000 * RENEWAL_THRESHOLD) return false;
  // 絶対期限へ張り付いた後は、書いても値が変わらない。書き込みだけを増やさない。
  return renewedExpiresAt(period, now).getTime() > period.expiresAt.getTime();
}
