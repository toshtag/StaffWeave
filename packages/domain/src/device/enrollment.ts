/**
 * 打刻端末の登録状態。
 *
 * 端末は「登録待ち」で作られ、Agent が資格情報を受け取ると「有効」になる。
 * 紛失や入れ替えのときは「失効」させ、以後の署名イベントを受け付けない。
 */
import { createMachine } from 'fsmxjs';

export const DEVICE_STATES = ['pending', 'active', 'revoked'] as const;

export type DeviceState = (typeof DEVICE_STATES)[number];

export function isDeviceState(value: string): value is DeviceState {
  return (DEVICE_STATES as readonly string[]).includes(value);
}

export const DEVICE_EVENTS = ['ENROLL', 'REVOKE'] as const;

export type DeviceEventType = (typeof DEVICE_EVENTS)[number];

export type DeviceEvent = { type: DeviceEventType };

export interface DeviceContext {
  /** 登録し直した回数。端末の入れ替えを追える。 */
  enrollments: number;
}

const machine = createMachine({
  initial: 'pending',
  context: { enrollments: 0 } as DeviceContext,
  types: { events: {} as DeviceEvent },
  states: {
    pending: {
      on: {
        ENROLL: {
          target: 'active',
          actions: (context) => ({ enrollments: context.enrollments + 1 }),
        },
        REVOKE: { target: 'revoked' },
      },
    },
    active: {
      on: { REVOKE: { target: 'revoked' } },
    },
    // 失効した端末は復帰させない。入れ替えるときは新しく登録する。
    revoked: {},
  },
});

function snapshotOf(state: DeviceState, context: DeviceContext) {
  return { value: state, context, event: { type: '@@fsmx/init' } as const };
}

export interface DeviceTransition {
  state: DeviceState;
  context: DeviceContext;
}

export const INITIAL_DEVICE: DeviceTransition = { state: 'pending', context: { enrollments: 0 } };

export function canApplyDeviceEvent(state: DeviceState, event: DeviceEventType): boolean {
  return machine.can(snapshotOf(state, machine.config.context), { type: event });
}

export function applyDeviceEvent(
  current: DeviceTransition,
  event: DeviceEventType,
): DeviceTransition | null {
  if (!canApplyDeviceEvent(current.state, event)) return null;
  const next = machine.transition(snapshotOf(current.state, current.context), { type: event });
  return { state: next.value, context: { ...next.context } };
}

/** 署名イベントを受け付けてよい状態か。 */
export function acceptsSignedEvents(state: DeviceState): boolean {
  return state === 'active';
}
