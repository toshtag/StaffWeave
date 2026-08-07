/**
 * 同じ要求が同時に届いても、PC セッションの観測が一度しか保存されないことを実データベースで確かめる。
 *
 * 事前の照会だけでは、二つのトランザクションがどちらも「まだ受け取っていない」と判断し、
 * どちらも観測を保存できる。ここで見るのは、要求単位の一意制約が保存を 1 件へ絞ることと、
 * 端末の行ロックが署名要求（打刻イベント・カード打刻・PC 観測）を
 * 同じ連番の上で直列化することである。
 * どちらも実時間の待機では再現しないため、二つの処理を同じ地点でそろえてから進ませる。
 */
import { generateKeyPair, signMessage, signPayload } from '@staffweave/agent';
import type { RecordSessionObservationsResponse } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import { canonicalCardEvent, canonicalSessionObservations } from '@staffweave/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApprovalRepository } from '../../src/approval/repository.js';
import { createCalculationRepository } from '../../src/attendance/calculation-repository.js';
import { createAttendanceRepository } from '../../src/attendance/repository.js';
import type { AuditRepository } from '../../src/audit/repository.js';
import { createAuditRepository } from '../../src/audit/repository.js';
import { createCardRepository } from '../../src/card/repository.js';
import type { CardRepositories } from '../../src/card/service.js';
import { createCardService } from '../../src/card/service.js';
import { createDeviceRepository } from '../../src/device/repository.js';
import type { DeviceRepositories } from '../../src/device/service.js';
import { createDeviceService } from '../../src/device/service.js';
import { createAssignmentRepository } from '../../src/organization/assignment-repository.js';
import { createRequestRepository } from '../../src/request/repository.js';
import { createScheduleRepository } from '../../src/schedule/repository.js';
import { createWorkCategoryRepository } from '../../src/schedule/work-category-repository.js';
import { createSessionObservationRepository } from '../../src/session/repository.js';
import type { SessionRepositories } from '../../src/session/service.js';
import { createSessionService } from '../../src/session/service.js';
import { createEmployeeVisibilityGuard } from '../../src/shared/employee-visibility.js';
import { createBarrier } from '../support/concurrency.js';
import {
  createEmployeeWithAccount,
  createOrganization,
  createWorkspace,
} from '../support/fixtures.js';

const NOW = new Date('2026-04-01T00:00:00.000Z');
const OCCURRED_AT = NOW.toISOString();
/** 端末の中で計算された指紋。生のカード識別子はここにも現れない。 */
const CARD_FINGERPRINT = 'a'.repeat(64);

interface EnrolledDevice {
  workspaceId: string;
  deviceId: string;
  privateKeyPem: string;
}

async function createWorkspaceWithDevice(slug: string): Promise<EnrolledDevice> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: `hanako@${slug}.example.com`,
  });
  await db.query(
    `INSERT INTO card_credentials (workspace_id, employee_id, fingerprint, label)
     VALUES ($1, $2, $3, '社員証')`,
    [workspaceId, employee.employeeId, CARD_FINGERPRINT],
  );
  return { workspaceId, ...(await enrollDevice(workspaceId)) };
}

async function enrollDevice(workspaceId: string): Promise<{
  deviceId: string;
  privateKeyPem: string;
}> {
  const keyPair = generateKeyPair();
  const rows = await testDatabase().query<{ id: string }>(
    `INSERT INTO devices (workspace_id, name, state, public_key, enrollments, enrolled_at)
     VALUES ($1, 'PC 監視', 'active', $2, 1, $3) RETURNING id`,
    [workspaceId, keyPair.publicKeyPem, NOW],
  );
  const deviceId = rows[0]?.id;
  if (deviceId === undefined) throw new Error('端末を作成できませんでした');
  return { deviceId, privateKeyPem: keyPair.privateKeyPem };
}

interface Hooks {
  /** 端末の行をロックする直前。ここでそろえると、両方が同じ端末へ進む。 */
  beforeLock?: () => Promise<void>;
  audit?: AuditRepository;
}

/** 端末が署名して送る要求が同じ端末の行で直列化されることを見るため、一式は共通にする。 */
type Repositories = SessionRepositories & DeviceRepositories & CardRepositories;

/**
 * 実データベースへ書く一式を組み立てる。
 *
 * 本番と同じ組み合わせのまま、待ち合わせと監査の失敗だけを差し込めるようにする。
 */
function transactionWith(hooks: Hooks) {
  const db = testDatabase();
  return <T>(fn: (repositories: Repositories) => Promise<T>): Promise<T> =>
    db.transaction((tx: Queryable) => {
      const devices = createDeviceRepository(tx);
      return fn({
        attendance: createAttendanceRepository(tx),
        schedule: createScheduleRepository(tx),
        calculations: createCalculationRepository(tx),
        approval: createApprovalRepository(tx),
        requests: createRequestRepository(tx),
        categories: createWorkCategoryRepository(tx),
        observations: createSessionObservationRepository(tx),
        cards: createCardRepository(tx),
        audit: hooks.audit ?? createAuditRepository(tx),
        devices: {
          ...devices,
          lock: async (workspaceId: string, deviceId: string) => {
            await hooks.beforeLock?.();
            return devices.lock(workspaceId, deviceId);
          },
        },
      });
    });
}

function sessionServiceWith(hooks: Hooks = {}) {
  const db = testDatabase();
  return createSessionService({
    repositories: {
      attendance: createAttendanceRepository(db),
      schedule: createScheduleRepository(db),
      calculations: createCalculationRepository(db),
      approval: createApprovalRepository(db),
      requests: createRequestRepository(db),
      categories: createWorkCategoryRepository(db),
    },
    observations: createSessionObservationRepository(db),
    devices: createDeviceRepository(db),
    visibility: createEmployeeVisibilityGuard({
      assignments: createAssignmentRepository(db),
      now: () => NOW,
    }),
    now: () => NOW,
    transaction: transactionWith(hooks),
  });
}

function deviceServiceWith(hooks: Hooks = {}) {
  const db = testDatabase();
  return createDeviceService({
    repository: createDeviceRepository(db),
    attendance: createAttendanceRepository(db),
    now: () => NOW,
    cardFingerprintMasterKey: null,
    transaction: transactionWith(hooks),
  });
}

function cardServiceWith(hooks: Hooks = {}) {
  const db = testDatabase();
  return createCardService({
    cards: createCardRepository(db),
    devices: createDeviceRepository(db),
    visibility: createEmployeeVisibilityGuard({
      assignments: createAssignmentRepository(db),
      now: () => NOW,
    }),
    now: () => NOW,
    transaction: transactionWith(hooks),
  });
}

function observationsRequest(
  sequence: number,
  requestId: string,
): {
  sequence: number;
  requestId: string;
  workstationName: string;
  observations: {
    employeeNumber: string;
    observationType: 'sign_in' | 'lock';
    occurredAt: string;
  }[];
} {
  return {
    sequence,
    requestId,
    workstationName: 'desk-01',
    observations: [
      { employeeNumber: 'E001', observationType: 'sign_in', occurredAt: OCCURRED_AT },
      { employeeNumber: 'E001', observationType: 'lock', occurredAt: OCCURRED_AT },
    ],
  };
}

function sendObservations(
  service: ReturnType<typeof createSessionService>,
  device: EnrolledDevice,
  sequence: number,
  requestId: string,
): Promise<{ result: RecordSessionObservationsResponse; created: boolean }> {
  const body = observationsRequest(sequence, requestId);
  const signature = signMessage(
    device.privateKeyPem,
    canonicalSessionObservations({ deviceId: device.deviceId, ...body }),
  );
  return service.recordObservations(device.deviceId, signature, body);
}

function sendEvent(
  service: ReturnType<typeof createDeviceService>,
  device: EnrolledDevice,
  sequence: number,
  requestId: string,
) {
  const payload = {
    sequence,
    requestId,
    employeeNumber: 'E001',
    eventType: 'clock_in' as const,
    occurredAt: OCCURRED_AT,
    deviceTime: OCCURRED_AT,
  };
  const signature = signPayload(device.privateKeyPem, {
    deviceId: device.deviceId,
    ...payload,
  });
  return service.recordEvent(device.deviceId, signature, payload);
}

function tapCard(
  service: ReturnType<typeof createCardService>,
  device: EnrolledDevice,
  sequence: number,
  requestId: string,
  eventType: 'clock_in' | 'clock_out' = 'clock_in',
) {
  const payload = {
    sequence,
    requestId,
    cardFingerprint: CARD_FINGERPRINT,
    eventType,
    occurredAt: OCCURRED_AT,
    deviceTime: OCCURRED_AT,
  };
  const signature = signMessage(
    device.privateKeyPem,
    canonicalCardEvent({ deviceId: device.deviceId, ...payload }),
  );
  return service.recordCardEvent(device.deviceId, signature, payload);
}

async function countOf(table: string): Promise<number> {
  const rows = await testDatabase().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return rows[0]?.count ?? 0;
}

async function lastSequenceOf(deviceId: string): Promise<number> {
  const rows = await testDatabase().query<{ last_sequence: number }>(
    'SELECT last_sequence FROM devices WHERE id = $1',
    [deviceId],
  );
  return rows[0]?.last_sequence ?? 0;
}

describe('同じ冪等キーの同時送信', () => {
  let device: EnrolledDevice;

  beforeEach(async () => {
    device = await createWorkspaceWithDevice('default');
  });

  it('観測が保存されるのは 1 回だけ', async () => {
    const barrier = createBarrier(2);
    const service = sessionServiceWith({ beforeLock: () => barrier.arriveAndWait() });

    const results = await Promise.all([
      sendObservations(service, device, 1, 'session-request-001'),
      sendObservations(service, device, 1, 'session-request-001'),
    ]);

    const outcomes = results.map((entry) => entry.result.outcome).sort();
    expect(outcomes).toEqual(['accepted', 'duplicate']);
    expect(results.filter((entry) => entry.created)).toHaveLength(1);
    expect(await countOf('workstation_session_receipts')).toBe(1);
    // 1 回の要求に入っていた 2 件だけが残る。
    expect(await countOf('workstation_session_observations')).toBe(2);
    expect(await countOf('audit_logs')).toBe(1);
    expect(await lastSequenceOf(device.deviceId)).toBe(1);
  });

  it('端末の行ロックとは別に、DB の一意制約が要求を 1 件へ絞る', async () => {
    const db = testDatabase();
    const other = await enrollDevice(device.workspaceId);
    const barrier = createBarrier(2);

    async function insertReceipt(deviceId: string): Promise<string | null> {
      return db.transaction(async (tx) => {
        const observations = createSessionObservationRepository(tx);
        const found = await observations.findReceiptByRequestId(
          device.workspaceId,
          'session-shared-request',
        );
        expect(found).toBeNull();

        // 双方が「まだ受け取っていない」と読んでから保存へ進む。
        await barrier.arriveAndWait();

        const receipt = await observations.insertReceipt(device.workspaceId, {
          deviceId,
          requestId: 'session-shared-request',
          sequence: 1,
          receivedAt: NOW,
          sequenceStep: 1,
          outcome: 'accepted',
          accepted: 2,
          skipped: 0,
        });
        return receipt.id;
      });
    }

    const results = await Promise.allSettled([
      insertReceipt(device.deviceId),
      insertReceipt(other.deviceId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(String(rejected?.reason)).toMatch(/workstation_session_receipts_request_key/);
    expect(await countOf('workstation_session_receipts')).toBe(1);
  });

  it('監査に失敗すれば受領記録も観測も残らず、同じ要求を送り直せる', async () => {
    const failing: AuditRepository = {
      record: async () => {
        throw new Error('監査記録を保存できませんでした');
      },
      listRecent: async () => [],
    };

    await expect(
      sendObservations(sessionServiceWith({ audit: failing }), device, 1, 'session-rollback'),
    ).rejects.toThrow('監査記録を保存できませんでした');

    expect(await countOf('workstation_session_receipts')).toBe(0);
    expect(await countOf('workstation_session_observations')).toBe(0);
    expect(await lastSequenceOf(device.deviceId)).toBe(0);

    const retried = await sendObservations(sessionServiceWith(), device, 1, 'session-rollback');
    expect(retried.result.outcome).toBe('accepted');
    expect(await countOf('workstation_session_receipts')).toBe(1);
  });
});

describe('打刻イベントと PC 観測の同時送信', () => {
  let device: EnrolledDevice;

  beforeEach(async () => {
    device = await createWorkspaceWithDevice('default');
  });

  it('同じ連番を使えば、成立するのは 1 件だけ', async () => {
    const barrier = createBarrier(2);
    const hooks = { beforeLock: () => barrier.arriveAndWait() };

    const results = await Promise.allSettled([
      sendEvent(deviceServiceWith(hooks), device, 1, 'device-event-1'),
      sendObservations(sessionServiceWith(hooks), device, 1, 'session-request-1'),
    ]);

    // どちらが先に着くかは決めない。決めるのは、連番が一つしか進まないことである。
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'conflict', status: 409 });
    expect(await lastSequenceOf(device.deviceId)).toBe(1);
  });
});

describe('カード打刻と PC 観測の連番', () => {
  let device: EnrolledDevice;

  beforeEach(async () => {
    device = await createWorkspaceWithDevice('default');
  });

  it('交互に送っても同じ端末連番を進める', async () => {
    const cards = cardServiceWith();
    const sessions = sessionServiceWith();

    await tapCard(cards, device, 1, 'card-event-1', 'clock_in');
    await sendObservations(sessions, device, 2, 'session-request-2');
    await tapCard(cards, device, 3, 'card-event-3', 'clock_out');
    await sendObservations(sessions, device, 4, 'session-request-4');

    expect(await lastSequenceOf(device.deviceId)).toBe(4);
    expect(await countOf('attendance_events')).toBe(2);
    expect(await countOf('workstation_session_observations')).toBe(4);
    expect(await countOf('workstation_session_receipts')).toBe(2);
  });

  it('同じ連番を同時に使えば、成立するのは 1 件だけ', async () => {
    const barrier = createBarrier(2);
    const hooks = { beforeLock: () => barrier.arriveAndWait() };

    const results = await Promise.allSettled([
      tapCard(cardServiceWith(hooks), device, 1, 'card-concurrent-1', 'clock_in'),
      sendObservations(sessionServiceWith(hooks), device, 1, 'session-concurrent-1'),
    ]);

    const [card, session] = results;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
      code: 'conflict',
      status: 409,
    });
    expect(await lastSequenceOf(device.deviceId)).toBe(1);

    // 成立した側だけが記録を残す。断った側は経路ごとの受信記録に残る。
    const cardWon = card?.status === 'fulfilled';
    expect(await countOf('attendance_events')).toBe(cardWon ? 1 : 0);
    expect(await countOf('workstation_session_observations')).toBe(
      session?.status === 'fulfilled' ? 2 : 0,
    );

    const receipts = await testDatabase().query<{ outcome: string }>(
      'SELECT outcome FROM workstation_session_receipts',
    );
    expect(receipts.map((row) => row.outcome)).toEqual([cardWon ? 'rejected' : 'accepted']);

    const eventReceipts = await testDatabase().query<{ outcome: string }>(
      'SELECT outcome FROM device_event_receipts',
    );
    expect(eventReceipts.map((row) => row.outcome)).toEqual([cardWon ? 'accepted' : 'rejected']);
  });
});
