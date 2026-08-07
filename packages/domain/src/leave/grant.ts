/**
 * 休暇の付与規則。
 *
 * 何か月の勤続で何分を付与するかは、事業者の就業規則と労使協定で決まる。
 * 製品は法定の日数を既定値として持たない。規則を置かないかぎり 1 分も付与しない。
 *
 * 対象日と入社日から勤続を数え、達している段のうちいちばん大きいものを採る。
 */

import type { BusinessDate } from '../attendance/business-date.js';
import { addDaysToBusinessDate } from '../attendance/business-date.js';

/** 自動付与の基準。 */
export const LEAVE_GRANT_BASES = ['hire_anniversary', 'fixed_date'] as const;

export type LeaveGrantBasis = (typeof LEAVE_GRANT_BASES)[number];

export function isLeaveGrantBasis(value: string): value is LeaveGrantBasis {
  return (LEAVE_GRANT_BASES as readonly string[]).includes(value);
}

export interface LeaveGrantRule {
  /** この勤続月数に達したら、この分数を付与する。 */
  serviceMonths: number;
  minutes: number;
}

/**
 * 入社日から対象日までの勤続月数。
 *
 * 「月」は暦月で数える。日で数えて 30 で割ると、31 日の月が続いたときに
 * 記念日より前に段が上がる。入社日と同じ日に達したところで 1 か月とする。
 */
export function serviceMonthsBetween(hiredOn: BusinessDate, asOf: BusinessDate): number {
  const [hiredYear, hiredMonth, hiredDay] = hiredOn.split('-').map(Number);
  const [year, month, day] = asOf.split('-').map(Number);
  if (
    hiredYear === undefined ||
    hiredMonth === undefined ||
    hiredDay === undefined ||
    year === undefined ||
    month === undefined ||
    day === undefined
  ) {
    throw new Error(`業務日として解釈できません: ${hiredOn} / ${asOf}`);
  }

  const months = (year - hiredYear) * 12 + (month - hiredMonth);
  // 記念日より前なら、その月はまだ満ちていない。
  return day >= hiredDay ? months : months - 1;
}

/**
 * その勤続に当たる付与分数。達している段が無ければ `null`。
 *
 * `null` は「付与しない」であって 0 分ではない。0 分の記録を積むと、
 * 台帳に意味の無い行が人数ぶん増える。
 */
export function grantMinutesFor(
  rules: readonly LeaveGrantRule[],
  serviceMonths: number,
): number | null {
  const reached = rules
    .filter((rule) => rule.serviceMonths <= serviceMonths)
    .sort((left, right) => right.serviceMonths - left.serviceMonths);
  return reached[0]?.minutes ?? null;
}

export interface GrantCandidate {
  employeeId: string;
  hiredOn: BusinessDate | null;
}

export interface PlannedGrant {
  employeeId: string;
  minutes: number;
  serviceMonths: number;
}

export type SkipReason = 'no_hire_date' | 'not_anniversary' | 'no_rule_reached';

export interface GrantPlan {
  grants: PlannedGrant[];
  /** 付与しなかった相手と、その理由。黙って飛ばすと、漏れに気付けない。 */
  skipped: { employeeId: string; reason: SkipReason }[];
}

/** 対象日が、その従業員の入社記念日か。 */
function isAnniversary(hiredOn: BusinessDate, effectiveOn: BusinessDate): boolean {
  return hiredOn.slice(5) === effectiveOn.slice(5);
}

/**
 * 誰へ何分を付与するかを決める。台帳へは積まない。
 *
 * 積む前に決め切ることで、対象と理由を呼ぶ側が確かめてから積める。
 *
 * @param basis `hire_anniversary` は入社記念日の人だけ。`fixed_date` は全員。
 */
export function planLeaveGrants(input: {
  basis: LeaveGrantBasis;
  effectiveOn: BusinessDate;
  rules: readonly LeaveGrantRule[];
  candidates: readonly GrantCandidate[];
}): GrantPlan {
  const grants: PlannedGrant[] = [];
  const skipped: GrantPlan['skipped'] = [];

  for (const candidate of input.candidates) {
    if (candidate.hiredOn === null) {
      // 勤続を数えられない。入社日を入れるまで対象にしない。
      skipped.push({ employeeId: candidate.employeeId, reason: 'no_hire_date' });
      continue;
    }
    if (
      input.basis === 'hire_anniversary' &&
      !isAnniversary(candidate.hiredOn, input.effectiveOn)
    ) {
      skipped.push({ employeeId: candidate.employeeId, reason: 'not_anniversary' });
      continue;
    }
    if (candidate.hiredOn > input.effectiveOn) {
      // 入社より前の日には付与しない。勤続が負になる。
      skipped.push({ employeeId: candidate.employeeId, reason: 'no_rule_reached' });
      continue;
    }

    const serviceMonths = serviceMonthsBetween(candidate.hiredOn, input.effectiveOn);
    const minutes = grantMinutesFor(input.rules, serviceMonths);
    if (minutes === null) {
      skipped.push({ employeeId: candidate.employeeId, reason: 'no_rule_reached' });
      continue;
    }
    grants.push({ employeeId: candidate.employeeId, minutes, serviceMonths });
  }

  return { grants, skipped };
}

/**
 * 自動付与で処理すべき日を、古い順に並べる。
 *
 * 定期実行は止まることがある。止まっていた期間を追いつくには、
 * 「どこから今日までを処理するか」を日の並びとして決める必要がある。
 *
 * 入社日基準では、すべての日が対象になる。その日が誰の記念日かは
 * `planLeaveGrants` が判断するため、ここでは日を落とさない。
 *
 * 一斉付与では、基準の月日に当たる日だけが対象になる。
 *
 * @param from 処理する最初の日。ここより前へは遡らない。
 * @param through 処理する最後の日。ふつうはその環境の「今日」。
 */
export function leaveGrantDatesBetween(input: {
  basis: LeaveGrantBasis;
  from: BusinessDate;
  through: BusinessDate;
  /** 一斉付与の基準日。入社日基準では見ない。 */
  fixedMonth?: number | null;
  fixedDay?: number | null;
}): BusinessDate[] {
  if (input.from > input.through) return [];

  const dates: BusinessDate[] = [];
  for (
    let cursor = input.from;
    cursor <= input.through;
    cursor = addDaysToBusinessDate(cursor, 1)
  ) {
    if (input.basis === 'hire_anniversary') {
      dates.push(cursor);
      continue;
    }
    // 一斉付与は、月日が決まっていなければ日そのものが決まらない。
    if (input.fixedMonth == null || input.fixedDay == null) return [];
    const [, month, day] = cursor.split('-').map(Number);
    if (month === input.fixedMonth && day === input.fixedDay) dates.push(cursor);
  }
  return dates;
}
