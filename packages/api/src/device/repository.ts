import type { DeviceReceiptRecord, DeviceRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { DeviceState } from '@staffweave/domain';

export interface DeviceRepository {
  list(workspaceId: string): Promise<DeviceRecord[]>;
  findById(workspaceId: string, deviceId: string): Promise<DeviceRecord | null>;
  /** 登録トークンのハッシュから端末を引く。ワークスペースは端末から決まる。 */
  findByEnrollmentTokenHash(
    tokenHash: string,
  ): Promise<(DeviceRecord & { workspaceId: string; workspaceSlug: string }) | null>;
  findPublicKey(workspaceId: string, deviceId: string): Promise<string | null>;
  /** 署名検証のため、ワークスペース指定なしで端末と公開鍵を引く。 */
  findForSignature(deviceId: string): Promise<{
    device: DeviceRecord;
    workspaceId: string;
    publicKey: string | null;
  } | null>;

  create(
    workspaceId: string,
    input: { name: string; siteId: string | null; enrollmentTokenHash: string },
  ): Promise<DeviceRecord>;
  markEnrolled(
    workspaceId: string,
    deviceId: string,
    input: { publicKey: string; enrollments: number; enrolledAt: Date },
  ): Promise<DeviceRecord>;
  markRevoked(workspaceId: string, deviceId: string, revokedAt: Date): Promise<DeviceRecord>;
  updateSequence(
    workspaceId: string,
    deviceId: string,
    input: { lastSequence: number; lastSeenAt: Date },
  ): Promise<void>;
  /** 同時に届いた署名イベントを直列化するための行ロック。 */
  lock(workspaceId: string, deviceId: string): Promise<boolean>;

  findReceiptByRequestId(
    workspaceId: string,
    deviceId: string,
    requestId: string,
  ): Promise<DeviceReceiptRecord | null>;
  listReceipts(
    workspaceId: string,
    deviceId: string,
    limit: number,
  ): Promise<DeviceReceiptRecord[]>;
  insertReceipt(
    workspaceId: string,
    input: {
      deviceId: string;
      sequence: number;
      requestId: string;
      receivedAt: Date;
      deviceTime: Date;
      clockSkewSeconds: number;
      sequenceStep: number;
      attendanceEventId: string | null;
      businessDate: string | null;
      outcome: DeviceReceiptRecord['outcome'];
      detail?: Record<string, unknown>;
    },
  ): Promise<DeviceReceiptRecord>;
}

interface DeviceRow {
  id: string;
  site_id: string | null;
  name: string;
  state: DeviceState;
  enrollments: number;
  last_sequence: number;
  enrolled_at: Date | null;
  revoked_at: Date | null;
  last_seen_at: Date | null;
  created_at: Date;
}

interface ReceiptRow {
  device_id: string;
  sequence: number;
  request_id: string;
  received_at: Date;
  device_time: Date;
  clock_skew_seconds: number;
  sequence_step: number;
  attendance_event_id: string | null;
  business_date: string | null;
  outcome: DeviceReceiptRecord['outcome'];
}

const DEVICE_COLUMNS = `id, site_id, name, state, enrollments, last_sequence,
  enrolled_at, revoked_at, last_seen_at, created_at`;
const RECEIPT_COLUMNS = `device_id, sequence, request_id, received_at, device_time,
  clock_skew_seconds, sequence_step, attendance_event_id, business_date, outcome`;

function toDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    state: row.state,
    enrollments: row.enrollments,
    lastSequence: row.last_sequence,
    enrolledAt: row.enrolled_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function toReceipt(row: ReceiptRow): DeviceReceiptRecord {
  return {
    deviceId: row.device_id,
    sequence: row.sequence,
    requestId: row.request_id,
    receivedAt: row.received_at.toISOString(),
    deviceTime: row.device_time.toISOString(),
    clockSkewSeconds: row.clock_skew_seconds,
    sequenceStep: row.sequence_step,
    attendanceEventId: row.attendance_event_id,
    businessDate: row.business_date,
    outcome: row.outcome,
  };
}

export function createDeviceRepository(db: Queryable): DeviceRepository {
  return {
    async list(workspaceId) {
      const rows = await db.query<DeviceRow>(
        `SELECT ${DEVICE_COLUMNS} FROM devices WHERE workspace_id = $1 ORDER BY created_at`,
        [workspaceId],
      );
      return rows.map(toDevice);
    },

    async findById(workspaceId, deviceId) {
      const rows = await db.query<DeviceRow>(
        `SELECT ${DEVICE_COLUMNS} FROM devices WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, deviceId],
      );
      return rows[0] ? toDevice(rows[0]) : null;
    },

    async findByEnrollmentTokenHash(tokenHash) {
      const rows = await db.query<DeviceRow & { workspace_id: string; slug: string }>(
        `SELECT ${DEVICE_COLUMNS.split(', ')
          .map((column) => `devices.${column.trim()}`)
          .join(', ')},
                devices.workspace_id, workspaces.slug
           FROM devices
           JOIN workspaces ON workspaces.id = devices.workspace_id
          WHERE devices.enrollment_token_hash = $1`,
        [tokenHash],
      );
      const row = rows[0];
      if (!row) return null;
      return { ...toDevice(row), workspaceId: row.workspace_id, workspaceSlug: row.slug };
    },

    async findPublicKey(workspaceId, deviceId) {
      const rows = await db.query<{ public_key: string | null }>(
        'SELECT public_key FROM devices WHERE workspace_id = $1 AND id = $2',
        [workspaceId, deviceId],
      );
      return rows[0]?.public_key ?? null;
    },

    async findForSignature(deviceId) {
      const rows = await db.query<DeviceRow & { workspace_id: string; public_key: string | null }>(
        `SELECT ${DEVICE_COLUMNS}, workspace_id, public_key FROM devices WHERE id = $1`,
        [deviceId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        device: toDevice(row),
        workspaceId: row.workspace_id,
        publicKey: row.public_key,
      };
    },

    async create(workspaceId, input) {
      const rows = await db.query<DeviceRow>(
        `INSERT INTO devices (workspace_id, site_id, name, enrollment_token_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING ${DEVICE_COLUMNS}`,
        [workspaceId, input.siteId, input.name, input.enrollmentTokenHash],
      );
      const row = rows[0];
      if (!row) throw new Error('端末を登録できませんでした');
      return toDevice(row);
    },

    async markEnrolled(workspaceId, deviceId, input) {
      const rows = await db.query<DeviceRow>(
        `UPDATE devices
            SET state = 'active',
                public_key = $3,
                enrollments = $4,
                enrolled_at = $5,
                -- 登録が済んだトークンは二度と使えないようにする。
                enrollment_token_hash = NULL,
                updated_at = now()
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${DEVICE_COLUMNS}`,
        [workspaceId, deviceId, input.publicKey, input.enrollments, input.enrolledAt],
      );
      const row = rows[0];
      if (!row) throw new Error('端末を有効化できませんでした');
      return toDevice(row);
    },

    async markRevoked(workspaceId, deviceId, revokedAt) {
      const rows = await db.query<DeviceRow>(
        `UPDATE devices
            SET state = 'revoked', revoked_at = $3, enrollment_token_hash = NULL, updated_at = now()
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${DEVICE_COLUMNS}`,
        [workspaceId, deviceId, revokedAt],
      );
      const row = rows[0];
      if (!row) throw new Error('端末を失効させられませんでした');
      return toDevice(row);
    },

    async updateSequence(workspaceId, deviceId, input) {
      await db.query(
        `UPDATE devices SET last_sequence = $3, last_seen_at = $4, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, deviceId, input.lastSequence, input.lastSeenAt],
      );
    },

    async lock(workspaceId, deviceId) {
      const rows = await db.query<{ id: string }>(
        'SELECT id FROM devices WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [workspaceId, deviceId],
      );
      return rows.length > 0;
    },

    async findReceiptByRequestId(workspaceId, deviceId, requestId) {
      const rows = await db.query<ReceiptRow>(
        `SELECT ${RECEIPT_COLUMNS} FROM device_event_receipts
          WHERE workspace_id = $1 AND device_id = $2 AND request_id = $3`,
        [workspaceId, deviceId, requestId],
      );
      return rows[0] ? toReceipt(rows[0]) : null;
    },

    async listReceipts(workspaceId, deviceId, limit) {
      const rows = await db.query<ReceiptRow>(
        `SELECT ${RECEIPT_COLUMNS} FROM device_event_receipts
          WHERE workspace_id = $1 AND device_id = $2
          ORDER BY sequence DESC LIMIT $3`,
        [workspaceId, deviceId, limit],
      );
      return rows.map(toReceipt);
    },

    async insertReceipt(workspaceId, input) {
      const rows = await db.query<ReceiptRow>(
        `INSERT INTO device_event_receipts
           (workspace_id, device_id, sequence, request_id, received_at, device_time,
            clock_skew_seconds, sequence_step, attendance_event_id, business_date, outcome, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         RETURNING ${RECEIPT_COLUMNS}`,
        [
          workspaceId,
          input.deviceId,
          input.sequence,
          input.requestId,
          input.receivedAt,
          input.deviceTime,
          input.clockSkewSeconds,
          input.sequenceStep,
          input.attendanceEventId,
          input.businessDate,
          input.outcome,
          JSON.stringify(input.detail ?? {}),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('受信記録を保存できませんでした');
      return toReceipt(row);
    },
  };
}
