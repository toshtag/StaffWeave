/**
 * 段階承認が、途中の定義変更や送信のやり直しで壊れないことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  allowsRequestEditing,
  applyStagedRequestEvent,
  isRequestEffective,
  type StagedRequest,
  submitStagedRequest,
} from './staged-request.js';

function approve(request: StagedRequest): StagedRequest {
  const result = applyStagedRequestEvent(request, {
    type: 'APPROVE',
    step: request.currentStep,
    submission: request.submissions,
  });
  if (!result.ok) throw new Error(`承認できませんでした: ${result.problem}`);
  return result.request;
}

describe('段階承認', () => {
  it('1 段の申請は、1 回の承認で終わる', () => {
    expect(approve(submitStagedRequest(1)).state).toBe('approved');
  });

  it('3 段の申請は、3 回目の承認で終わる', () => {
    let request = submitStagedRequest(3);

    request = approve(request);
    expect(request).toMatchObject({ state: 'submitted', currentStep: 2 });

    request = approve(request);
    expect(request).toMatchObject({ state: 'submitted', currentStep: 3 });

    request = approve(request);
    expect(request.state).toBe('approved');
  });

  it('同じ段の承認を送り直しても、次の段へ進まない', () => {
    const request = approve(submitStagedRequest(3));

    // 古い画面が持っている段は 1。すでに 2 段目を待っている。
    expect(applyStagedRequestEvent(request, { type: 'APPROVE', step: 1, submission: 1 })).toEqual({
      ok: false,
      problem: 'step_mismatch',
    });
  });

  it('先の段を飛ばして承認できない', () => {
    expect(
      applyStagedRequestEvent(submitStagedRequest(3), {
        type: 'APPROVE',
        step: 3,
        submission: 1,
      }),
    ).toEqual({ ok: false, problem: 'step_mismatch' });
  });

  it('決着した申請には、もう決裁できない', () => {
    const approved = approve(submitStagedRequest(1));

    expect(applyStagedRequestEvent(approved, { type: 'APPROVE', step: 1, submission: 1 })).toEqual({
      ok: false,
      problem: 'already_decided',
    });
  });
});

describe('差し戻しと出し直し', () => {
  it('どの段からでも差し戻せる', () => {
    const request = approve(submitStagedRequest(3));
    const returned = applyStagedRequestEvent(request, { type: 'RETURN', step: 2, submission: 1 });

    expect(returned).toEqual({
      ok: true,
      request: { state: 'returned', totalSteps: 3, currentStep: 2, submissions: 1 },
    });
  });

  it('出し直すと 1 段目からやり直し、提出回数が増える', () => {
    const returned = applyStagedRequestEvent(submitStagedRequest(3), {
      type: 'RETURN',
      step: 1,
      submission: 1,
    });
    if (!returned.ok) throw new Error('差し戻しできませんでした');

    expect(applyStagedRequestEvent(returned.request, { type: 'RESUBMIT' })).toEqual({
      ok: true,
      request: { state: 'submitted', totalSteps: 3, currentStep: 1, submissions: 2 },
    });
  });

  it('前の提出に宛てた決裁は、出し直したあとの申請へ効かない', () => {
    const returned = applyStagedRequestEvent(submitStagedRequest(2), {
      type: 'RETURN',
      step: 1,
      submission: 1,
    });
    if (!returned.ok) throw new Error('差し戻しできませんでした');
    const resubmitted = applyStagedRequestEvent(returned.request, { type: 'RESUBMIT' });
    if (!resubmitted.ok) throw new Error('出し直せませんでした');

    expect(
      applyStagedRequestEvent(resubmitted.request, { type: 'APPROVE', step: 1, submission: 1 }),
    ).toEqual({ ok: false, problem: 'submission_mismatch' });
  });

  it('差し戻し中は決裁を受け付けない', () => {
    const returned = applyStagedRequestEvent(submitStagedRequest(2), {
      type: 'RETURN',
      step: 1,
      submission: 1,
    });
    if (!returned.ok) throw new Error('差し戻しできませんでした');

    expect(
      applyStagedRequestEvent(returned.request, { type: 'APPROVE', step: 1, submission: 1 }),
    ).toEqual({ ok: false, problem: 'not_pending' });
  });

  it('出し直せるのは差し戻し中だけ', () => {
    expect(applyStagedRequestEvent(submitStagedRequest(2), { type: 'RESUBMIT' })).toEqual({
      ok: false,
      problem: 'not_returned',
    });
  });
});

describe('取り下げ', () => {
  it('承認の途中でも取り下げられる', () => {
    const request = approve(submitStagedRequest(3));

    expect(applyStagedRequestEvent(request, { type: 'CANCEL' })).toMatchObject({
      ok: true,
      request: { state: 'cancelled' },
    });
  });

  it('承認済みの申請は取り下げられない', () => {
    const approved = approve(submitStagedRequest(1));

    expect(applyStagedRequestEvent(approved, { type: 'CANCEL' })).toEqual({
      ok: false,
      problem: 'already_decided',
    });
  });
});

describe('承認中の定義変更', () => {
  it('段数を増やしても、進行中の申請は出したときの段数で終わる', () => {
    // 提出時の定義は 2 段。あとで定義が 4 段になっても、この申請は 2 段で終わる。
    let request = submitStagedRequest(2);

    request = approve(request);
    request = approve(request);

    expect(request.state).toBe('approved');
    expect(request.totalSteps).toBe(2);
  });

  it('段数を減らしても、進行中の申請から段が消えない', () => {
    // 提出時の定義は 3 段。定義が 1 段になっても、残りの段は残る。
    let request = submitStagedRequest(3);

    request = approve(request);
    expect(request.state).toBe('submitted');
    request = approve(request);
    expect(request.state).toBe('submitted');
    request = approve(request);
    expect(request.state).toBe('approved');
  });
});

describe('状態でできること', () => {
  it('内容を直せるのは差し戻し中だけ', () => {
    expect(allowsRequestEditing('returned')).toBe(true);
    expect(allowsRequestEditing('submitted')).toBe(false);
    expect(allowsRequestEditing('approved')).toBe(false);
  });

  it('反映するのは承認済みだけ', () => {
    expect(isRequestEffective('approved')).toBe(true);
    expect(isRequestEffective('submitted')).toBe(false);
    expect(isRequestEffective('cancelled')).toBe(false);
  });
});
