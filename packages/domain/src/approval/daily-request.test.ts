import { describe, expect, it } from 'vitest';
import {
  allowsAttendanceEditing,
  applyDailyRequestEvent,
  canApplyDailyRequestEvent,
  INITIAL_DAILY_REQUEST,
  isDailyRequestState,
} from './daily-request.js';

describe('日次申請の状態遷移', () => {
  it('下書きから提出できる', () => {
    const next = applyDailyRequestEvent(INITIAL_DAILY_REQUEST, 'SUBMIT');
    expect(next?.state).toBe('submitted');
    expect(next?.context.submissions).toBe(1);
  });

  it('提出済みを承認できる', () => {
    const submitted = applyDailyRequestEvent(INITIAL_DAILY_REQUEST, 'SUBMIT');
    expect(submitted).not.toBeNull();
    if (!submitted) return;
    expect(applyDailyRequestEvent(submitted, 'APPROVE')?.state).toBe('approved');
  });

  it('差し戻すと回数が増え、再提出できる', () => {
    const submitted = applyDailyRequestEvent(INITIAL_DAILY_REQUEST, 'SUBMIT');
    if (!submitted) throw new Error('提出できませんでした');
    const returned = applyDailyRequestEvent(submitted, 'RETURN');

    expect(returned?.state).toBe('returned');
    expect(returned?.context.returns).toBe(1);
    if (!returned) return;

    const resubmitted = applyDailyRequestEvent(returned, 'SUBMIT');
    expect(resubmitted?.state).toBe('submitted');
    expect(resubmitted?.context.submissions).toBe(2);
  });

  it('下書きと提出済みは取り消せる', () => {
    expect(applyDailyRequestEvent(INITIAL_DAILY_REQUEST, 'CANCEL')?.state).toBe('cancelled');

    const submitted = applyDailyRequestEvent(INITIAL_DAILY_REQUEST, 'SUBMIT');
    if (!submitted) throw new Error('提出できませんでした');
    expect(applyDailyRequestEvent(submitted, 'CANCEL')?.state).toBe('cancelled');
  });

  it('承認済みは締め解除のときだけ差し戻しへ戻せる', () => {
    const state = { state: 'approved' as const, context: { submissions: 1, returns: 0 } };
    expect(applyDailyRequestEvent(state, 'REOPEN')?.state).toBe('returned');
    expect(applyDailyRequestEvent(state, 'CANCEL')).toBeNull();
    expect(applyDailyRequestEvent(state, 'APPROVE')).toBeNull();
  });

  it('取消済みからはどこへも進めない', () => {
    const state = { state: 'cancelled' as const, context: { submissions: 1, returns: 0 } };
    for (const event of ['SUBMIT', 'APPROVE', 'RETURN', 'CANCEL', 'REOPEN'] as const) {
      expect(applyDailyRequestEvent(state, event)).toBeNull();
    }
  });

  it('下書きをいきなり承認できない', () => {
    expect(canApplyDailyRequestEvent('draft', 'APPROVE')).toBe(false);
    expect(applyDailyRequestEvent(INITIAL_DAILY_REQUEST, 'APPROVE')).toBeNull();
  });

  it('差し戻し済みを承認できない', () => {
    expect(canApplyDailyRequestEvent('returned', 'APPROVE')).toBe(false);
  });
});

describe('allowsAttendanceEditing', () => {
  it('提出中と承認済みは打刻を編集できない', () => {
    expect(allowsAttendanceEditing('draft')).toBe(true);
    expect(allowsAttendanceEditing('returned')).toBe(true);
    expect(allowsAttendanceEditing('cancelled')).toBe(true);
    expect(allowsAttendanceEditing('submitted')).toBe(false);
    expect(allowsAttendanceEditing('approved')).toBe(false);
  });
});

describe('isDailyRequestState', () => {
  it('未知の値を拒否する', () => {
    expect(isDailyRequestState('submitted')).toBe(true);
    expect(isDailyRequestState('rejected')).toBe(false);
  });
});
