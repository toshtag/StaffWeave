/**
 * ログインの失敗を数える既定値。
 *
 * 利用者ごとと送信元ごとで基準を分ける。
 * 利用者ごとは、特定の相手への総当たりを止めるために厳しくする。
 * 送信元ごとは、共有回線の事務所で全員が締め出されないよう緩くし、
 * 多数の利用者へ少しずつ試す形だけを止める。
 */

import type { LoginAttemptPolicy } from '@staffweave/domain';

export interface LoginAttemptPolicies {
  account: LoginAttemptPolicy;
  source: LoginAttemptPolicy;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const DEFAULT_LOGIN_ATTEMPT_POLICY: LoginAttemptPolicies = {
  account: { maxFailures: 5, windowMs: FIFTEEN_MINUTES_MS, blockMs: FIFTEEN_MINUTES_MS },
  source: { maxFailures: 50, windowMs: FIFTEEN_MINUTES_MS, blockMs: FIFTEEN_MINUTES_MS },
};
