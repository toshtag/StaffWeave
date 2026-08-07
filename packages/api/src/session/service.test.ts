import { generateKeyPair, signMessage } from '@staffweave/agent';
import type { RecordSessionObservationsRequest } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import { canonicalSessionObservations } from '@staffweave/domain';
import { describe, expect, it } from 'vitest';
import { createApprovalRepository } from '../approval/repository.js';
import { createCalculationRepository } from '../attendance/calculation-repository.js';
import { createAttendanceRepository } from '../attendance/repository.js';
import type { AuditEntry, AuditRepository } from '../audit/repository.js';
import { createDeviceRepository } from '../device/repository.js';
import { createRequestRepository } from '../request/repository.js';
import { createScheduleRepository } from '../schedule/repository.js';
import { createWorkCategoryRepository } from '../schedule/work-category-repository.js';
import { ApiError } from '../shared/errors.js';
import {
  createSessionObservationRepository,
  SESSION_RECEIPT_REQUEST_CONSTRAINT,
  type SessionObservationReceipt,
} from './repository.js';
import { createSessionService, type SessionRepositories } from './service.js';

/**
 * まとめ送りの受け取り順を固定する。
 *
 * 見たいのは「何を先に判断するか」である。再送の判定が連番より後になると、
 * 一度受理した要求の再送が連番の再利用として断られる。
 * 断った要求をトランザクションの中で例外にすると、拒否の記録も一緒に消える。
 * どちらも通常の受け取りは成功するため、テストがなければ気付けない。
 */

const NOW = new Date('2026-04-01T00:00:00.000Z');
const WORKSPACE_ID = 'workspace-1';
const DEVICE_ID = 'device-1';
const REQUEST_ID = 'session-request-001';

const keyPair = generateKeyPair();

/** この経路で使うはずのない問い合わせは、呼ばれた時点で分かるようにする。 */
const unusedDatabase: Queryable = {
  query: async () => {
    throw new Error('PC セッションの受け取りではこの問い合わせを使いません');
  },
};

const activeDevice = {
  id: DEVICE_ID,
  siteId: null,
  name: 'PC 監視',
  state: 'active' as const,
  enrollments: 1,
  lastSequence: 0,
  enrolledAt: '2026-03-31T00:00:00.000Z',
  revokedAt: null,
  lastSeenAt: null,
  createdAt: '2026-03-31T00:00:00.000Z',
};

function acceptedReceipt(
  overrides: Partial<SessionObservationReceipt> = {},
): SessionObservationReceipt {
  return {
    id: 'receipt-1',
    workspaceId: WORKSPACE_ID,
    deviceId: DEVICE_ID,
    requestId: REQUEST_ID,
    sequence: 1,
    receivedAt: NOW,
    sequenceStep: 1,
    outcome: 'accepted',
    accepted: 1,
    skipped: 0,
    detail: {},
    ...overrides,
  };
}

function requestOf(
  overrides: Partial<RecordSessionObservationsRequest> = {},
): RecordSessionObservationsRequest {
  return {
    sequence: 1,
    requestId: REQUEST_ID,
    workstationName: 'desk-01',
    observations: [
      { employeeNumber: 'E001', observationType: 'sign_in', occurredAt: NOW.toISOString() },
    ],
    ...overrides,
  };
}

interface Calls {
  employeeLookups: string[];
  observations: string[];
  receipts: Parameters<SessionRepositories['observations']['insertReceipt']>[1][];
  audited: AuditEntry[];
  sequences: number[];
  rolledBack: boolean;
}

interface State {
  lastSequence?: number;
  receipt?: SessionObservationReceipt | null;
  legacy?: boolean;
  /** 見つかる従業員番号。ここに無い番号は対象外として数える。 */
  employees?: readonly string[];
  onInsertReceipt?: () => never;
}

function serviceWith(state: State = {}): {
  service: ReturnType<typeof createSessionService>;
  calls: Calls;
} {
  const calls: Calls = {
    employeeLookups: [],
    observations: [],
    receipts: [],
    audited: [],
    sequences: [],
    rolledBack: false,
  };
  const employees = state.employees ?? ['E001'];

  const audit: AuditRepository = {
    record: async (_workspaceId, entry) => {
      calls.audited.push(entry);
    },
    listRecent: async () => [],
  };

  const observations: SessionRepositories['observations'] = {
    ...createSessionObservationRepository(unusedDatabase),
    findReceiptByRequestId: async () => state.receipt ?? null,
    existsLegacyRequest: async () => state.legacy ?? false,
    insertReceipt: async (_workspaceId, input) => {
      calls.receipts.push(input);
      state.onInsertReceipt?.();
      return acceptedReceipt({ ...input, workspaceId: WORKSPACE_ID, detail: input.detail ?? {} });
    },
    insert: async (_workspaceId, input) => {
      calls.observations.push(input.observationType);
      return {
        id: `observation-${calls.observations.length}`,
        employeeId: input.employeeId,
        observationType: input.observationType,
        occurredAt: input.occurredAt.toISOString(),
        recordedAt: NOW.toISOString(),
        businessDate: input.businessDate,
        workstationName: input.workstationName,
      };
    },
  };

  const repositories: SessionRepositories = {
    attendance: {
      ...createAttendanceRepository(unusedDatabase),
      findEmployeeByNumber: async (_workspaceId, employeeNumber) => {
        calls.employeeLookups.push(employeeNumber);
        if (!employees.includes(employeeNumber)) return null;
        return { id: `employee-${employeeNumber}`, displayName: '勤怠 花子' };
      },
      findTimeZoneForEmployee: async () => 'Asia/Tokyo',
    },
    schedule: createScheduleRepository(unusedDatabase),
    calculations: createCalculationRepository(unusedDatabase),
    approval: createApprovalRepository(unusedDatabase),
    requests: createRequestRepository(unusedDatabase),
    categories: createWorkCategoryRepository(unusedDatabase),
    devices: {
      ...createDeviceRepository(unusedDatabase),
      findForSignature: async () => ({
        device: { ...activeDevice, lastSequence: state.lastSequence ?? 0 },
        workspaceId: WORKSPACE_ID,
        publicKey: keyPair.publicKeyPem,
      }),
      lock: async () => true,
      findById: async () => ({ ...activeDevice, lastSequence: state.lastSequence ?? 0 }),
      updateSequence: async (_workspaceId, _deviceId, input) => {
        calls.sequences.push(input.lastSequence);
      },
    },
    observations,
    audit,
  };

  const service = createSessionService({
    repositories,
    observations,
    devices: repositories.devices,
    visibility: {
      of: () => ({ kind: 'none' }),
      requireVisibleEmployee: async () => {},
      filterVisible: async (_context, items) => [...items],
    },
    now: () => NOW,
    transaction: async (fn) => {
      try {
        return await fn(repositories);
      } catch (error) {
        // 取り消しになったかどうかを見分けるため、例外だけを記録して素通しする。
        calls.rolledBack = true;
        throw error;
      }
    },
  });

  return { service, calls };
}

function send(
  service: ReturnType<typeof createSessionService>,
  input: RecordSessionObservationsRequest,
) {
  const signature = signMessage(
    keyPair.privateKeyPem,
    canonicalSessionObservations({ deviceId: DEVICE_ID, ...input }),
  );
  return service.recordObservations(DEVICE_ID, signature, input);
}

describe('recordObservations', () => {
  it('受け取り済みの要求は、観測も監査も増やさず再送として返す', async () => {
    const { service, calls } = serviceWith({ receipt: acceptedReceipt({ accepted: 2 }) });

    const { result, created } = await send(service, requestOf());

    expect(result).toEqual({ outcome: 'duplicate', accepted: 0, skipped: 0 });
    expect(created).toBe(false);
    expect(calls.employeeLookups).toEqual([]);
    expect(calls.observations).toEqual([]);
    expect(calls.receipts).toEqual([]);
    expect(calls.audited).toEqual([]);
    expect(calls.sequences).toEqual([]);
  });

  it('受領記録より前に受け取った要求も、観測から再送と判定する', async () => {
    const { service, calls } = serviceWith({ receipt: null, legacy: true });

    const { result, created } = await send(service, requestOf());

    expect(result.outcome).toBe('duplicate');
    expect(created).toBe(false);
    expect(calls.observations).toEqual([]);
  });

  it('再送の判定は連番より先に行う', async () => {
    // 一度受理したあと、連番は先へ進んでいる。同じ冪等キーの再送はそれでも再送である。
    const { service, calls } = serviceWith({
      lastSequence: 9,
      receipt: acceptedReceipt({ sequence: 1 }),
    });

    const { result } = await send(service, requestOf({ sequence: 1 }));

    expect(result.outcome).toBe('duplicate');
    expect(calls.receipts).toEqual([]);
  });

  it('受け取り済みの連番を別の冪等キーで送れば断り、断ったことを残す', async () => {
    const { service, calls } = serviceWith({ lastSequence: 5 });

    const error = await send(
      service,
      requestOf({ sequence: 5, requestId: 'session-request-b' }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'conflict', status: 409 });
    expect(calls.receipts).toEqual([
      {
        deviceId: DEVICE_ID,
        requestId: 'session-request-b',
        sequence: 5,
        receivedAt: NOW,
        sequenceStep: 0,
        outcome: 'rejected',
        accepted: 0,
        skipped: 0,
        detail: { reason: 'sequence_replay', lastSequence: 5 },
      },
    ]);
    expect(calls.observations).toEqual([]);
    expect(calls.audited).toEqual([]);
    expect(calls.sequences).toEqual([]);
  });

  it('断った要求でもトランザクションは取り消さない', async () => {
    const { service, calls } = serviceWith({ lastSequence: 5 });

    await send(service, requestOf({ sequence: 3, requestId: 'session-request-c' })).catch(
      () => undefined,
    );

    // 中で例外を投げると、拒否の記録も一緒に消える。
    expect(calls.rolledBack).toBe(false);
    expect(calls.receipts[0]?.outcome).toBe('rejected');
  });

  it('連番の欠落は受理し、欠落数を受領記録と監査へ残す', async () => {
    const { service, calls } = serviceWith({ lastSequence: 1 });

    const { result, created } = await send(service, requestOf({ sequence: 4 }));

    expect(result).toEqual({ outcome: 'accepted', accepted: 1, skipped: 0 });
    expect(created).toBe(true);
    expect(calls.receipts[0]).toMatchObject({
      sequence: 4,
      sequenceStep: 3,
      outcome: 'accepted',
      detail: { sequenceGap: 2 },
    });
    expect(calls.audited[0]?.detail).toMatchObject({
      sequence: 4,
      sequenceStep: 3,
      sequenceGap: 2,
      accepted: 1,
      skipped: 0,
    });
    expect(calls.sequences).toEqual([4]);
  });

  it('欠落がなければ欠落数を残さない', async () => {
    const { service, calls } = serviceWith({ lastSequence: 0 });

    await send(service, requestOf({ sequence: 1 }));

    expect(calls.receipts[0]?.detail).toEqual({});
    expect(calls.audited[0]?.detail).not.toHaveProperty('sequenceGap');
  });

  it('すべて対象外の要求でも受領記録を残し、連番を進める', async () => {
    const { service, calls } = serviceWith({ employees: [] });

    const { result } = await send(
      service,
      requestOf({
        observations: [
          { employeeNumber: 'E998', observationType: 'sign_in', occurredAt: NOW.toISOString() },
          { employeeNumber: 'E999', observationType: 'lock', occurredAt: NOW.toISOString() },
        ],
      }),
    );

    expect(result).toEqual({ outcome: 'accepted', accepted: 0, skipped: 2 });
    expect(calls.observations).toEqual([]);
    expect(calls.receipts[0]).toMatchObject({ outcome: 'accepted', accepted: 0, skipped: 2 });
    expect(calls.sequences).toEqual([1]);
  });

  it('同じ冪等キーが同時に確定したら、先の記録に合わせて再送として返す', async () => {
    const violation = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: SESSION_RECEIPT_REQUEST_CONSTRAINT,
    });
    const state: State = {
      receipt: null,
      onInsertReceipt: () => {
        // 先に確定した側の記録が読めるようになってから、こちらは巻き戻る。
        state.receipt = acceptedReceipt();
        throw violation;
      },
    };
    const { service, calls } = serviceWith(state);

    const { result, created } = await send(service, requestOf());

    expect(result.outcome).toBe('duplicate');
    expect(created).toBe(false);
    expect(calls.rolledBack).toBe(true);
  });

  it('別の一意制約違反は再送として扱わない', async () => {
    const violation = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'workstation_session_observations_pkey',
    });
    const { service } = serviceWith({
      onInsertReceipt: () => {
        throw violation;
      },
    });

    await expect(send(service, requestOf())).rejects.toBe(violation);
  });
});
