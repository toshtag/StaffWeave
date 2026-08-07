/**
 * 承認の経路と、その段を決裁してよい相手の判断。
 *
 * 段数だけを固定しても、経路を固定したことにはならない。段ごとの承認者が
 * 決まっていなければ、承認の権限を持つ利用者は 1 段目も 4 段目も同じように
 * 通せる。段を分けた意味が無い。
 *
 * 代理の決裁は、任せた側の記録があるときだけ許す。記録が無いまま
 * 「本来の承認者」を書けると、監査は決裁する側の申告をそのまま信じることになる。
 */

import type { Role } from '../identity/roles.js';

/** 承認者の決め方。 */
export const APPROVER_POLICIES = [
  'user',
  'organization_manager',
  'workspace_admin',
  /**
   * 承認の権限を持つ利用者なら誰でも。
   *
   * 段ごとの承認者を持たなかった頃の挙動を、そのまま表す値。
   * 暗黙の既定として隠さず、設定として見えるようにするために置く。
   * 段を分ける意味を持たせるなら、他の方針へ置き換える。
   */
  'any_approver',
] as const;

export type ApproverPolicy = (typeof APPROVER_POLICIES)[number];

export function isApproverPolicy(value: string): value is ApproverPolicy {
  return (APPROVER_POLICIES as readonly string[]).includes(value);
}

export interface ApprovalStep {
  step: number;
  /** `policy` が `user` のときの承認者。それ以外では null。 */
  approverUserId: string | null;
  approverPolicy: ApproverPolicy;
}

/** 決裁しようとしている利用者。 */
export interface ApprovalActor {
  userId: string;
  roles: readonly Role[];
  /**
   * この利用者が代理を任されている相手。
   *
   * 有効期間の判断は読み出す側で済ませ、ここには効いている委任だけを渡す。
   */
  delegatedFrom: readonly string[];
}

export type ApprovalDenial =
  /** その段の承認者ではない。 */
  | 'not_approver'
  /** 代理として名乗った相手が、その段の承認者ではない。 */
  | 'not_delegating_approver'
  /** 代理を任されていない。 */
  | 'no_delegation';

export type ApprovalAuthorization =
  | { ok: true; onBehalfOfUserId: string | null }
  | { ok: false; problem: ApprovalDenial };

/**
 * その段を決裁してよいかを決める。
 *
 * 代理を名乗った場合は、名乗った相手がその段の承認者であること、
 * かつその相手から委任を受けていることの両方を求める。
 * 片方だけでは、監査へ残る帰属が事実と一致しない。
 *
 * 方針で決まる段には代理を認めない。「組織の管理者が承認する」段で
 * 特定の誰かの代理を名乗っても、その誰かが承認者だったとは言えない。
 */
export function authorizeApproval(input: {
  step: ApprovalStep;
  actor: ApprovalActor;
  onBehalfOfUserId?: string | null;
}): ApprovalAuthorization {
  const { step, actor } = input;
  const onBehalfOfUserId = input.onBehalfOfUserId ?? null;

  if (onBehalfOfUserId !== null) {
    if (step.approverPolicy !== 'user' || step.approverUserId !== onBehalfOfUserId) {
      return { ok: false, problem: 'not_delegating_approver' };
    }
    if (!actor.delegatedFrom.includes(onBehalfOfUserId)) {
      return { ok: false, problem: 'no_delegation' };
    }
    return { ok: true, onBehalfOfUserId };
  }

  if (step.approverPolicy === 'user') {
    if (step.approverUserId === actor.userId) return { ok: true, onBehalfOfUserId: null };
    // 委任を受けていれば、名乗らなくても決裁できる。ただし帰属は本来の承認者へ残す。
    if (step.approverUserId !== null && actor.delegatedFrom.includes(step.approverUserId)) {
      return { ok: true, onBehalfOfUserId: step.approverUserId };
    }
    return { ok: false, problem: 'not_approver' };
  }

  if (step.approverPolicy === 'any_approver') return { ok: true, onBehalfOfUserId: null };

  return actor.roles.includes(step.approverPolicy)
    ? { ok: true, onBehalfOfUserId: null }
    : { ok: false, problem: 'not_approver' };
}
