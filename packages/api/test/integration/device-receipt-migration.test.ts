import type { Database } from '@staffweave/db';
import { migrate } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { migrationsUpTo, useTemporaryDatabases } from '../support/migration-database.js';

/**
 * 応答の再現に必要な値の追加が、すでに動いている環境を壊さないことを確かめる。
 *
 * 0018 は受領記録へ列を足し、既存の行を埋める。受理した記録の種別は打刻イベントから、
 * 断った記録の理由は detail に残した reason から補える。補ったあとで検査を足すため、
 * 当時の記録が残ったまま新しい検査を満たせることを固定する。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const UPGRADED = 'staffweave_device_receipt_upgrade_test';
const FRESH = 'staffweave_device_receipt_fresh_test';

const LAST_VERSION_BEFORE_RESPONSE_VALUES = 17;

const NOW = new Date('2026-04-01T00:00:00.000Z');
const BUSINESS_DATE = '2026-04-01';

interface Workspace {
  workspaceId: string;
  employeeId: string;
  deviceId: string;
}

/** 受領記録を保存できる最小の一式を作る。 */
async function createWorkspaceWith(db: Database, slug: string): Promise<Workspace> {
  const workspaces = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, slug],
  );
  const workspaceId = workspaces[0]?.id ?? '';
  const organizations = await db.query<{ id: string }>(
    "INSERT INTO organizations (workspace_id, code, name) VALUES ($1, 'HQ', '本社') RETURNING id",
    [workspaceId],
  );
  const employees = await db.query<{ id: string }>(
    `INSERT INTO employees (workspace_id, organization_id, employee_number, display_name)
     VALUES ($1, $2, 'E001', '勤怠 花子') RETURNING id`,
    [workspaceId, organizations[0]?.id ?? ''],
  );
  const devices = await db.query<{ id: string }>(
    `INSERT INTO devices (workspace_id, name, state, public_key)
     VALUES ($1, '入口の端末', 'active', 'public-key') RETURNING id`,
    [workspaceId],
  );
  return {
    workspaceId,
    employeeId: employees[0]?.id ?? '',
    deviceId: devices[0]?.id ?? '',
  };
}

async function insertAttendanceEvent(
  db: Database,
  workspace: Workspace,
  requestId: string,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO attendance_events
       (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
     VALUES ($1, $2, 'clock_in', $3, $4, 'device', $5) RETURNING id`,
    [workspace.workspaceId, workspace.employeeId, NOW, BUSINESS_DATE, requestId],
  );
  return rows[0]?.id ?? '';
}

/** 0018 より前の形で受領記録を保存する。応答の再現に使う列はまだ無い。 */
async function insertLegacyReceipt(
  db: Database,
  workspace: Workspace,
  input: {
    requestId: string;
    sequence: number;
    outcome: string;
    attendanceEventId?: string;
    reason?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO device_event_receipts
       (workspace_id, device_id, sequence, request_id, received_at, device_time,
        clock_skew_seconds, sequence_step, attendance_event_id, business_date, outcome, detail)
     VALUES ($1, $2, $3, $4, $5, $5, 0, 1, $6, $7, $8, $9::jsonb)`,
    [
      workspace.workspaceId,
      workspace.deviceId,
      input.sequence,
      input.requestId,
      NOW,
      input.attendanceEventId ?? null,
      input.attendanceEventId === undefined ? null : BUSINESS_DATE,
      input.outcome,
      JSON.stringify(input.reason === undefined ? {} : { reason: input.reason }),
    ],
  );
}

interface ReceiptValues {
  event_type: string | null;
  rejection_code: string | null;
  rejection_message: string | null;
}

async function receiptOf(db: Database, requestId: string): Promise<ReceiptValues | undefined> {
  const rows = await db.query<ReceiptValues>(
    `SELECT event_type, rejection_code, rejection_message
       FROM device_event_receipts WHERE request_id = $1`,
    [requestId],
  );
  return rows[0];
}

let upgradedWorkspace: Workspace;
let freshWorkspace: Workspace;
let acceptedEventId: string;

const temporary = useTemporaryDatabases([UPGRADED, FRESH], async ({ database }) => {
  // 0017 までを適用し、当時の形で受理と拒否の記録を保存してから 0018 を適用する。
  await migrate(database(UPGRADED), await migrationsUpTo(LAST_VERSION_BEFORE_RESPONSE_VALUES));
  upgradedWorkspace = await createWorkspaceWith(database(UPGRADED), 'default');
  acceptedEventId = await insertAttendanceEvent(
    database(UPGRADED),
    upgradedWorkspace,
    'legacy-accepted',
  );
  await insertLegacyReceipt(database(UPGRADED), upgradedWorkspace, {
    requestId: 'legacy-accepted',
    sequence: 1,
    outcome: 'accepted',
    attendanceEventId: acceptedEventId,
  });
  for (const [index, reason] of ['unknown_card', 'sequence_replay', 'punch_rejected'].entries()) {
    await insertLegacyReceipt(database(UPGRADED), upgradedWorkspace, {
      requestId: `legacy-rejected-${reason}`,
      sequence: index + 2,
      outcome: 'rejected',
      reason,
    });
  }
  await migrate(database(UPGRADED));

  await migrate(database(FRESH));
  freshWorkspace = await createWorkspaceWith(database(FRESH), 'default');
});

const upgraded = () => temporary.database(UPGRADED);
const fresh = () => temporary.database(FRESH);

describe('0017 まで適用済みのデータベース', () => {
  it('受理した記録の種別を打刻イベントから補う', async () => {
    expect(await receiptOf(upgraded(), 'legacy-accepted')).toEqual({
      event_type: 'clock_in',
      rejection_code: null,
      rejection_message: null,
    });
  });

  it('断った記録の理由を detail の reason から補う', async () => {
    expect(await receiptOf(upgraded(), 'legacy-rejected-unknown_card')).toEqual({
      event_type: null,
      rejection_code: 'not_found',
      rejection_message: '登録されたカードが見つかりません',
    });
    expect(await receiptOf(upgraded(), 'legacy-rejected-sequence_replay')).toEqual({
      event_type: null,
      rejection_code: 'conflict',
      rejection_message: '連番がすでに受け取った値以下です',
    });
  });

  it('元の文言が残っていない拒否には、種別を伴わない文言を入れる', async () => {
    expect(await receiptOf(upgraded(), 'legacy-rejected-punch_rejected')).toEqual({
      event_type: null,
      rejection_code: 'conflict',
      rejection_message: 'この打刻は受け付けられません',
    });
  });

  it('保存されていた受領記録の件数と結果を変えない', async () => {
    const rows = await upgraded().query<{ outcome: string; count: number }>(
      'SELECT outcome, count(*)::int AS count FROM device_event_receipts GROUP BY outcome',
    );

    expect(Object.fromEntries(rows.map((row) => [row.outcome, row.count]))).toEqual({
      accepted: 1,
      rejected: 3,
    });
  });

  it('補ったあとも受領記録は書き換えられない', async () => {
    await expect(
      upgraded().query('DELETE FROM device_event_receipts WHERE request_id = $1', [
        'legacy-accepted',
      ]),
    ).rejects.toThrow(/追記のみ/);
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(upgraded());

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('空のデータベース', () => {
  /** 応答の再現に必要な値を欠いた受領記録を作ろうとする。 */
  const invalid = (columns: string, values: string) =>
    fresh().query(
      `INSERT INTO device_event_receipts
         (workspace_id, device_id, sequence, request_id, device_time,
          clock_skew_seconds, sequence_step, ${columns})
       VALUES ($1, $2, 1, 'invalid-device-request', $3, 0, 1, ${values})`,
      [freshWorkspace.workspaceId, freshWorkspace.deviceId, NOW],
    );

  it('受理した記録は種別を欠かせない', async () => {
    await expect(invalid('outcome', "'accepted'")).rejects.toThrow(/accepted_event_type/);
  });

  it('断った記録は理由を欠かせない', async () => {
    await expect(invalid('outcome', "'rejected'")).rejects.toThrow(/rejection_presence/);
  });

  it('受理した記録に拒否の理由を持たせられない', async () => {
    await expect(
      invalid(
        'outcome, event_type, rejection_code, rejection_message',
        "'accepted', 'clock_in', 'conflict', '断りました'",
      ),
    ).rejects.toThrow(/rejection_presence/);
  });

  it('種別と応答コードは決められた値しか持てない', async () => {
    await expect(invalid('outcome, event_type', "'accepted', 'clock_pause'")).rejects.toThrow(
      /event_type_values/,
    );
    await expect(
      invalid('outcome, rejection_code, rejection_message', "'rejected', 'teapot', '断りました'"),
    ).rejects.toThrow(/rejection_code_values/);
  });

  it('受理と拒否のどちらも保存できる', async () => {
    const eventId = await insertAttendanceEvent(fresh(), freshWorkspace, 'fresh()-accepted');

    await expect(
      fresh().query(
        `INSERT INTO device_event_receipts
           (workspace_id, device_id, sequence, request_id, device_time, clock_skew_seconds,
            sequence_step, attendance_event_id, business_date, outcome, event_type)
         VALUES ($1, $2, 1, 'fresh()-accepted', $3, 0, 1, $4, $5, 'accepted', 'clock_in')`,
        [freshWorkspace.workspaceId, freshWorkspace.deviceId, NOW, eventId, BUSINESS_DATE],
      ),
    ).resolves.toBeDefined();

    await expect(
      fresh().query(
        `INSERT INTO device_event_receipts
           (workspace_id, device_id, sequence, request_id, device_time, clock_skew_seconds,
            sequence_step, outcome, rejection_code, rejection_message)
         VALUES ($1, $2, 2, 'fresh()-rejected', $3, 0, 1, 'rejected', 'conflict', 'すでに退勤済みです')`,
        [freshWorkspace.workspaceId, freshWorkspace.deviceId, NOW],
      ),
    ).resolves.toBeDefined();
  });
});
