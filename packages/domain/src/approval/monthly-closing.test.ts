import { describe, expect, it } from 'vitest';
import {
  allowsAttendanceEditing,
  applyMonthlyClosingEvent,
  closingPeriodOf,
  INITIAL_MONTHLY_CLOSING,
} from './monthly-closing.js';

describe('月次締めの状態遷移', () => {
  it('締めると closed になる', () => {
    expect(applyMonthlyClosingEvent(INITIAL_MONTHLY_CLOSING, 'CLOSE')?.state).toBe('closed');
  });

  it('締めていない月は解除できない', () => {
    expect(applyMonthlyClosingEvent(INITIAL_MONTHLY_CLOSING, 'REOPEN')).toBeNull();
  });

  it('二重の締めはできない', () => {
    const closed = applyMonthlyClosingEvent(INITIAL_MONTHLY_CLOSING, 'CLOSE');
    if (!closed) throw new Error('締められませんでした');
    expect(applyMonthlyClosingEvent(closed, 'CLOSE')).toBeNull();
  });

  it('解除の回数を数える', () => {
    const closed = applyMonthlyClosingEvent(INITIAL_MONTHLY_CLOSING, 'CLOSE');
    if (!closed) throw new Error('締められませんでした');
    const reopened = applyMonthlyClosingEvent(closed, 'REOPEN');

    expect(reopened?.state).toBe('open');
    expect(reopened?.context.reopens).toBe(1);
    if (!reopened) return;

    const closedAgain = applyMonthlyClosingEvent(reopened, 'CLOSE');
    if (!closedAgain) throw new Error('締められませんでした');
    expect(applyMonthlyClosingEvent(closedAgain, 'REOPEN')?.context.reopens).toBe(2);
  });
});

describe('allowsAttendanceEditing', () => {
  it('締めた月は編集できない', () => {
    expect(allowsAttendanceEditing('open')).toBe(true);
    expect(allowsAttendanceEditing('closed')).toBe(false);
  });
});

describe('closingPeriodOf', () => {
  it('業務日からその月の 1 日を求める', () => {
    expect(closingPeriodOf('2026-04-15')).toBe('2026-04-01');
    expect(closingPeriodOf('2026-12-31')).toBe('2026-12-01');
  });
});
