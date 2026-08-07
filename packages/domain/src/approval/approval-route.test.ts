/**
 * 段ごとの承認者による認可。
 *
 * ここで固定したいのは 3 つ。
 *
 *   その段の承認者でなければ通せないこと
 *   代理は、任された記録があるときだけ通ること
 *   代理として名乗った相手が、実際にその段の承認者であること
 */
import { describe, expect, it } from 'vitest';
import type { ApprovalStep } from './approval-route.js';
import { authorizeApproval } from './approval-route.js';

const namedStep: ApprovalStep = {
  step: 1,
  approverUserId: 'user-approver',
  approverPolicy: 'user',
};

const managerStep: ApprovalStep = {
  step: 2,
  approverUserId: null,
  approverPolicy: 'organization_manager',
};

describe('段の承認者による認可', () => {
  it('指名された承認者は通せる', () => {
    expect(
      authorizeApproval({
        step: namedStep,
        actor: { userId: 'user-approver', roles: ['organization_manager'], delegatedFrom: [] },
      }),
    ).toEqual({ ok: true, onBehalfOfUserId: null });
  });

  /**
   * 承認の権限を持っているだけでは通せない。
   * ここを緩めると、段を分けた意味が無くなる。
   */
  it('承認の権限を持つ別の利用者は通せない', () => {
    expect(
      authorizeApproval({
        step: namedStep,
        actor: { userId: 'user-other', roles: ['workspace_admin'], delegatedFrom: [] },
      }),
    ).toEqual({ ok: false, problem: 'not_approver' });
  });

  it('方針で決まる段は、その役割を持つ利用者が通せる', () => {
    expect(
      authorizeApproval({
        step: managerStep,
        actor: { userId: 'user-manager', roles: ['organization_manager'], delegatedFrom: [] },
      }),
    ).toEqual({ ok: true, onBehalfOfUserId: null });
  });

  it('方針で決まる段でも、役割が違えば通せない', () => {
    expect(
      authorizeApproval({
        step: managerStep,
        actor: { userId: 'user-employee', roles: ['employee'], delegatedFrom: [] },
      }),
    ).toEqual({ ok: false, problem: 'not_approver' });
  });
});

describe('代理の決裁', () => {
  it('任された相手なら、名乗らなくても通せる。帰属は本来の承認者へ残す', () => {
    expect(
      authorizeApproval({
        step: namedStep,
        actor: {
          userId: 'user-deputy',
          roles: ['organization_manager'],
          delegatedFrom: ['user-approver'],
        },
      }),
    ).toEqual({ ok: true, onBehalfOfUserId: 'user-approver' });
  });

  it('任された相手が名乗った場合も通せる', () => {
    expect(
      authorizeApproval({
        step: namedStep,
        actor: {
          userId: 'user-deputy',
          roles: ['organization_manager'],
          delegatedFrom: ['user-approver'],
        },
        onBehalfOfUserId: 'user-approver',
      }),
    ).toEqual({ ok: true, onBehalfOfUserId: 'user-approver' });
  });

  /**
   * 任されていない相手の名前を書けると、監査へ残る帰属を決裁する側が
   * 好きに決められる。
   */
  it('任されていなければ、名乗っても通せない', () => {
    expect(
      authorizeApproval({
        step: namedStep,
        actor: { userId: 'user-deputy', roles: ['workspace_admin'], delegatedFrom: [] },
        onBehalfOfUserId: 'user-approver',
      }),
    ).toEqual({ ok: false, problem: 'no_delegation' });
  });

  it('その段の承認者でない相手の代理は名乗れない', () => {
    expect(
      authorizeApproval({
        step: namedStep,
        actor: {
          userId: 'user-deputy',
          roles: ['workspace_admin'],
          delegatedFrom: ['user-someone'],
        },
        onBehalfOfUserId: 'user-someone',
      }),
    ).toEqual({ ok: false, problem: 'not_delegating_approver' });
  });

  it('方針で決まる段では、誰の代理も名乗れない', () => {
    expect(
      authorizeApproval({
        step: managerStep,
        actor: {
          userId: 'user-deputy',
          roles: ['organization_manager'],
          delegatedFrom: ['user-approver'],
        },
        onBehalfOfUserId: 'user-approver',
      }),
    ).toEqual({ ok: false, problem: 'not_delegating_approver' });
  });
});
