/**
 * 日次申請の状態遷移。
 *
 * 遷移の定義を状態機械へ集約し、画面や API が独自の条件分岐で
 * 「今この操作をしてよいか」を判断しないようにする。
 */
import { createMachine } from 'fsmxjs';

export const DAILY_REQUEST_STATES = [
  'draft',
  'submitted',
  'approved',
  'returned',
  'cancelled',
] as const;

export type DailyRequestState = (typeof DAILY_REQUEST_STATES)[number];

export function isDailyRequestState(value: string): value is DailyRequestState {
  return (DAILY_REQUEST_STATES as readonly string[]).includes(value);
}

export const DAILY_REQUEST_EVENTS = ['SUBMIT', 'APPROVE', 'RETURN', 'CANCEL', 'REOPEN'] as const;

export type DailyRequestEventType = (typeof DAILY_REQUEST_EVENTS)[number];

export type DailyRequestEvent = { type: DailyRequestEventType };

/** 状態機械が持つ付随情報。何回やり取りしたかを申請の履歴として残す。 */
export interface DailyRequestContext {
  submissions: number;
  returns: number;
}

// 状態値を型として推論させるため、ジェネリクスを明示せず types でイベントだけを与える。
const machine = createMachine({
  initial: 'draft',
  context: { submissions: 0, returns: 0 } as DailyRequestContext,
  types: { events: {} as DailyRequestEvent },
  states: {
    draft: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: (context) => ({ submissions: context.submissions + 1 }),
        },
        CANCEL: { target: 'cancelled' },
      },
    },
    submitted: {
      on: {
        APPROVE: { target: 'approved' },
        RETURN: {
          target: 'returned',
          actions: (context) => ({ returns: context.returns + 1 }),
        },
        CANCEL: { target: 'cancelled' },
      },
    },
    returned: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: (context) => ({ submissions: context.submissions + 1 }),
        },
        CANCEL: { target: 'cancelled' },
      },
    },
    approved: {
      // 締めを解除したときだけ、承認済みを差し戻しへ戻せる。
      on: { REOPEN: { target: 'returned' } },
    },
    cancelled: {},
  },
});

function snapshotOf(state: DailyRequestState, context: DailyRequestContext) {
  return { value: state, context, event: { type: '@@fsmx/init' } as const };
}

export function canApplyDailyRequestEvent(
  state: DailyRequestState,
  event: DailyRequestEventType,
): boolean {
  return machine.can(snapshotOf(state, machine.config.context), { type: event });
}

export interface DailyRequestTransition {
  state: DailyRequestState;
  context: DailyRequestContext;
}

/**
 * 状態を進める。受け付けられない遷移では null を返す。
 * 呼び出し側は null を「その操作は今できない」として扱う。
 */
export function applyDailyRequestEvent(
  current: DailyRequestTransition,
  event: DailyRequestEventType,
): DailyRequestTransition | null {
  if (!canApplyDailyRequestEvent(current.state, event)) return null;
  const next = machine.transition(snapshotOf(current.state, current.context), { type: event });
  return { state: next.value, context: { ...next.context } };
}

export const INITIAL_DAILY_REQUEST: DailyRequestTransition = {
  state: 'draft',
  context: { submissions: 0, returns: 0 },
};

/** その状態のとき、打刻や修正を受け付けてよいか。 */
export function allowsAttendanceEditing(state: DailyRequestState): boolean {
  return state === 'draft' || state === 'returned' || state === 'cancelled';
}
