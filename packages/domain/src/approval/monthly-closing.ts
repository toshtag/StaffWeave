/**
 * 月次締めの状態遷移。
 *
 * 締めた月は打刻・修正を受け付けない。やり直す必要があるときは、
 * 理由を伴って締めを解除し、その事実を記録に残す。
 */
import { createMachine } from 'fsmxjs';

export const MONTHLY_CLOSING_STATES = ['open', 'closed'] as const;

export type MonthlyClosingState = (typeof MONTHLY_CLOSING_STATES)[number];

export function isMonthlyClosingState(value: string): value is MonthlyClosingState {
  return (MONTHLY_CLOSING_STATES as readonly string[]).includes(value);
}

export const MONTHLY_CLOSING_EVENTS = ['CLOSE', 'REOPEN'] as const;

export type MonthlyClosingEventType = (typeof MONTHLY_CLOSING_EVENTS)[number];

export type MonthlyClosingEvent = { type: MonthlyClosingEventType };

export interface MonthlyClosingContext {
  /** 締めを解除した回数。多すぎる解除は運用上の異常として検出できる。 */
  reopens: number;
}

// 状態値を型として推論させるため、ジェネリクスを明示せず types でイベントだけを与える。
const machine = createMachine({
  initial: 'open',
  context: { reopens: 0 } as MonthlyClosingContext,
  types: { events: {} as MonthlyClosingEvent },
  states: {
    open: {
      on: { CLOSE: { target: 'closed' } },
    },
    closed: {
      on: {
        REOPEN: {
          target: 'open',
          actions: (context) => ({ reopens: context.reopens + 1 }),
        },
      },
    },
  },
});

function snapshotOf(state: MonthlyClosingState, context: MonthlyClosingContext) {
  return { value: state, context, event: { type: '@@fsmx/init' } as const };
}

export interface MonthlyClosingTransition {
  state: MonthlyClosingState;
  context: MonthlyClosingContext;
}

export const INITIAL_MONTHLY_CLOSING: MonthlyClosingTransition = {
  state: 'open',
  context: { reopens: 0 },
};

export function canApplyMonthlyClosingEvent(
  state: MonthlyClosingState,
  event: MonthlyClosingEventType,
): boolean {
  return machine.can(snapshotOf(state, machine.config.context), { type: event });
}

export function applyMonthlyClosingEvent(
  current: MonthlyClosingTransition,
  event: MonthlyClosingEventType,
): MonthlyClosingTransition | null {
  if (!canApplyMonthlyClosingEvent(current.state, event)) return null;
  const next = machine.transition(snapshotOf(current.state, current.context), { type: event });
  return { state: next.value, context: { ...next.context } };
}

/** 締めた月は編集できない。 */
export function allowsAttendanceEditing(state: MonthlyClosingState): boolean {
  return state === 'open';
}

/** 業務日が属する締め期間（その月の 1 日）。 */
export function closingPeriodOf(businessDate: string): string {
  const [year, month] = businessDate.split('-');
  if (year === undefined || month === undefined) {
    throw new Error(`業務日として解釈できません: ${businessDate}`);
  }
  return `${year}-${month}-01`;
}
