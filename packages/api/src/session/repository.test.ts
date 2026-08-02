import type { Queryable } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { recordingDatabase } from '../../test/support/fake-database.js';
import { createSessionObservationRepository } from './repository.js';

/**
 * まとめ送りの冪等性を、観測行ではなく受領記録で保証していることを固定する。
 *
 * 1 回の要求には観測が複数入るため、観測テーブルには同じ冪等キーの行が並ぶ。
 * 冪等キーの一意性を観測側へ移すと通常の複数件送信が壊れ、受領記録側から外すと
 * 同時再送が二重に保存できてしまう。どちらもテストがなければ気付けない。
 */

const RECEIVED_AT = new Date('2026-04-01T00:00:00.000Z');

const receiptRow = {
  id: 'receipt-1',
  workspace_id: 'workspace-1',
  device_id: 'device-1',
  request_id: 'session-request-001',
  sequence: 4,
  received_at: RECEIVED_AT,
  sequence_step: 3,
  outcome: 'accepted',
  accepted: 2,
  skipped: 0,
  detail: { sequenceGap: 2 },
};

const receiptInput = {
  deviceId: 'device-1',
  requestId: 'session-request-001',
  sequence: 4,
  receivedAt: RECEIVED_AT,
  sequenceStep: 3,
  outcome: 'accepted' as const,
  accepted: 2,
  skipped: 0,
  detail: { sequenceGap: 2 },
};

describe('findReceiptByRequestId', () => {
  it('ワークスペースと冪等キーで引く', async () => {
    const { queries, db } = recordingDatabase([receiptRow]);

    await createSessionObservationRepository(db).findReceiptByRequestId(
      'workspace-1',
      'session-request-001',
    );

    expect(queries[0]?.text).toMatch(/FROM workstation_session_receipts/);
    expect(queries[0]?.text).toMatch(/workspace_id = \$1/);
    expect(queries[0]?.text).toMatch(/request_id = \$2/);
    expect(queries[0]?.params).toEqual(['workspace-1', 'session-request-001']);
  });

  it('保存した内容をそのまま受領記録として返す', async () => {
    const { db } = recordingDatabase([receiptRow]);

    const receipt = await createSessionObservationRepository(db).findReceiptByRequestId(
      'workspace-1',
      'session-request-001',
    );

    expect(receipt).toEqual({
      id: 'receipt-1',
      workspaceId: 'workspace-1',
      deviceId: 'device-1',
      requestId: 'session-request-001',
      sequence: 4,
      receivedAt: RECEIVED_AT,
      sequenceStep: 3,
      outcome: 'accepted',
      accepted: 2,
      skipped: 0,
      detail: { sequenceGap: 2 },
    });
  });

  it('受け取っていなければ null を返す', async () => {
    const { db } = recordingDatabase([]);

    await expect(
      createSessionObservationRepository(db).findReceiptByRequestId('workspace-1', 'unknown'),
    ).resolves.toBeNull();
  });
});

describe('insertReceipt', () => {
  it('受領した連番と件数をそのまま渡す', async () => {
    const { queries, db } = recordingDatabase([receiptRow]);

    await createSessionObservationRepository(db).insertReceipt('workspace-1', receiptInput);

    expect(queries[0]?.text).toMatch(/INSERT INTO workstation_session_receipts/);
    expect(queries[0]?.text).toMatch(/RETURNING/);
    expect(queries[0]?.params).toEqual([
      'workspace-1',
      'device-1',
      'session-request-001',
      4,
      RECEIVED_AT,
      3,
      'accepted',
      2,
      0,
      JSON.stringify({ sequenceGap: 2 }),
    ]);
  });

  it('一意制約違反を握りつぶさない', async () => {
    const violation = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'workstation_session_receipts_request_key',
    });
    const db: Queryable = {
      query: async () => {
        throw violation;
      },
    };

    await expect(
      createSessionObservationRepository(db).insertReceipt('workspace-1', receiptInput),
    ).rejects.toBe(violation);
  });
});

describe('existsLegacyRequest', () => {
  it('件数を数えず、存在の有無だけを問い合わせる', async () => {
    const { queries, db } = recordingDatabase([{ exists: true }]);

    const exists = await createSessionObservationRepository(db).existsLegacyRequest(
      'workspace-1',
      'session-request-001',
    );

    expect(exists).toBe(true);
    expect(queries[0]?.text).toMatch(/SELECT EXISTS/);
    expect(queries[0]?.text).not.toMatch(/count\(/);
    expect(queries[0]?.text).toMatch(/workspace_id = \$1/);
    expect(queries[0]?.text).toMatch(/request_id = \$2/);
    expect(queries[0]?.params).toEqual(['workspace-1', 'session-request-001']);
  });
});

describe('insert', () => {
  it('同じ冪等キーの観測を、要求 1 回分としてそのまま並べて保存する', async () => {
    const observationRow = {
      id: 'observation-1',
      employee_id: 'employee-1',
      observation_type: 'sign_in',
      occurred_at: RECEIVED_AT,
      recorded_at: RECEIVED_AT,
      business_date: '2026-04-01',
      workstation_name: 'desk-01',
    };
    const { queries, db } = recordingDatabase([observationRow]);
    const repository = createSessionObservationRepository(db);
    const line = {
      employeeId: 'employee-1',
      deviceId: 'device-1',
      occurredAt: RECEIVED_AT,
      businessDate: '2026-04-01',
      requestId: 'session-request-001',
      workstationName: 'desk-01',
    };

    await repository.insert('workspace-1', { ...line, observationType: 'sign_in' });
    await repository.insert('workspace-1', { ...line, observationType: 'lock' });

    expect(queries).toHaveLength(2);
    expect(queries.map((query) => query.params[6])).toEqual([
      'session-request-001',
      'session-request-001',
    ]);
  });
});
