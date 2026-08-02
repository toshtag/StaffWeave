import type { DeviceReceiptRecord, DeviceRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { AttendanceEventType, DeviceState } from '@staffweave/domain';
import type { ApiErrorCode } from '../shared/errors.js';
import { isApiErrorCode } from '../shared/errors.js';

/** 断ったときに返した応答。同じ冪等キーの再送へ、同じ理由を返すために残す。 */
export interface DeviceReceiptRejection {
  code: ApiErrorCode;
  message: string;
}

/**
 * 端末からの要求 1 件に対する受領記録。
 *
 * 一覧に出す `DeviceReceiptRecord` へ、応答の再現に必要な値を足したもの。
 * 再送に何を返すかはこの記録だけで決まり、そのときの勤務状態を見直さない。
 */
export interface DeviceEventReceipt extends DeviceReceiptRecord {
  /** 受理した打刻の種別。断った記録では null。 */
  eventType: AttendanceEventType | null;
  rejection: DeviceReceiptRejection | null;
}

interface DeviceReceiptInputBase {
  deviceId: string;
  sequence: number;
  requestId: string;
  receivedAt: Date;
  deviceTime: Date;
  clockSkewSeconds: number;
  sequenceStep: number;
  detail?: Record<string, unknown>;
}

/**
 * 受領記録に残す内容。
 *
 * 受理と拒否で残す値が違うことを型で示し、応答を再現できない記録を作らせない。
 * DB 側にも同じ内容の検査を置いている。
 */
export type InsertDeviceReceiptInput = DeviceReceiptInputBase &
  (
    | {
        outcome: 'accepted' | 'duplicate';
        attendanceEventId: string;
        businessDate: string;
        eventType: AttendanceEventType;
      }
    | { outcome: 'rejected'; rejection: DeviceReceiptRejection }
  );

export interface DeviceRepository {
  list(workspaceId: string): Promise<DeviceRecord[]>;
  findById(workspaceId: string, deviceId: string): Promise<DeviceRecord | null>;
  /** 登録トークンのハッシュから端末を引く。ワークスペースは端末から決まる。 */
  findByEnrollmentTokenHash(tokenHash: string): Promise<
    | (DeviceRecord & {
        workspaceId: string;
        workspaceSlug: string;
        /** 登録トークンの期限。トークンを持つ端末では必ず入る。 */
        enrollmentTokenExpiresAt: Date | null;
      })
    | null
  >;
  findPublicKey(workspaceId: string, deviceId: string): Promise<string | null>;
  /** 署名検証のため、ワークスペース指定なしで端末と公開鍵を引く。 */
  findForSignature(deviceId: string): Promise<{
    device: DeviceRecord;
    workspaceId: string;
    publicKey: string | null;
  } | null>;

  create(
    workspaceId: string,
    input: {
      name: string;
      siteId: string | null;
      enrollmentTokenHash: string;
      enrollmentTokenExpiresAt: Date;
    },
  ): Promise<DeviceRecord>;
  /**
   * 登録待ちの端末だけを有効にする。
   *
   * 一度きりの登録トークンを消費するのはこの更新であり、事前の検索ではない。
   * 同じトークンで同時に届いた要求のうち、条件に合致した 1 件だけが更新でき、
   * 残りは `null` を受け取る。期限の確認も同じ条件へ入れる。
   */
  markEnrolledIfPending(
    workspaceId: string,
    deviceId: string,
    input: {
      enrollmentTokenHash: string;
      publicKey: string;
      enrollments: number;
      enrolledAt: Date;
    },
  ): Promise<DeviceRecord | null>;
  markRevoked(workspaceId: string, deviceId: string, revokedAt: Date): Promise<DeviceRecord>;
  updateSequence(
    workspaceId: string,
    deviceId: string,
    input: { lastSequence: number; lastSeenAt: Date },
  ): Promise<void>;
  /** 同時に届いた署名イベントを直列化するための行ロック。 */
  lock(workspaceId: string, deviceId: string): Promise<boolean>;

  /** 同じ冪等キーで受け取り済みかどうか。受理と拒否のどちらも残る。 */
  findReceiptByRequestId(
    workspaceId: string,
    deviceId: string,
    requestId: string,
  ): Promise<DeviceEventReceipt | null>;
  listReceipts(
    workspaceId: string,
    deviceId: string,
    limit: number,
  ): Promise<DeviceReceiptRecord[]>;
  insertReceipt(workspaceId: string, input: InsertDeviceReceiptInput): Promise<DeviceEventReceipt>;
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
  event_type: AttendanceEventType | null;
  rejection_code: string | null;
  rejection_message: string | null;
}

const DEVICE_COLUMNS = `id, site_id, name, state, enrollments, last_sequence,
  enrolled_at, revoked_at, last_seen_at, created_at`;
const RECEIPT_COLUMNS = `device_id, sequence, request_id, received_at, device_time,
  clock_skew_seconds, sequence_step, attendance_event_id, business_date, outcome,
  event_type, rejection_code, rejection_message`;

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

function toRejection(row: ReceiptRow): DeviceReceiptRejection | null {
  if (row.rejection_code === null || row.rejection_message === null) return null;
  // 保存できるコードは DB の検査で限っている。合わない値は記録の破損として扱う。
  if (!isApiErrorCode(row.rejection_code)) {
    throw new Error(`受領記録の応答コードが不正です: ${row.rejection_code}`);
  }
  return { code: row.rejection_code, message: row.rejection_message };
}

/** 一覧に出す形。応答の再現に使う値は契約へ出さず、サーバーの内部記録として扱う。 */
function toReceiptRecord(row: ReceiptRow): DeviceReceiptRecord {
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

function toReceipt(row: ReceiptRow): DeviceEventReceipt {
  return { ...toReceiptRecord(row), eventType: row.event_type, rejection: toRejection(row) };
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
      const rows = await db.query<
        DeviceRow & {
          workspace_id: string;
          slug: string;
          enrollment_token_expires_at: Date | null;
        }
      >(
        `SELECT ${DEVICE_COLUMNS.split(', ')
          .map((column) => `devices.${column.trim()}`)
          .join(', ')},
                devices.workspace_id, devices.enrollment_token_expires_at, workspaces.slug
           FROM devices
           JOIN workspaces ON workspaces.id = devices.workspace_id
          WHERE devices.enrollment_token_hash = $1`,
        [tokenHash],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        ...toDevice(row),
        workspaceId: row.workspace_id,
        workspaceSlug: row.slug,
        enrollmentTokenExpiresAt: row.enrollment_token_expires_at,
      };
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
        `INSERT INTO devices
           (workspace_id, site_id, name, enrollment_token_hash, enrollment_token_expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${DEVICE_COLUMNS}`,
        [
          workspaceId,
          input.siteId,
          input.name,
          input.enrollmentTokenHash,
          input.enrollmentTokenExpiresAt,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('端末を登録できませんでした');
      return toDevice(row);
    },

    async markEnrolledIfPending(workspaceId, deviceId, input) {
      const rows = await db.query<DeviceRow>(
        `UPDATE devices
            SET state = 'active',
                public_key = $4,
                enrollments = $5,
                enrolled_at = $6,
                -- 登録が済んだトークンは二度と使えないようにする。
                enrollment_token_hash = NULL,
                enrollment_token_expires_at = NULL,
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            -- 登録できる状態と、渡されたトークンであることを更新の条件にする。
            -- 先に読んだ結果ではなく、この条件に合致したことが消費の証跡になる。
            AND state = 'pending'
            AND public_key IS NULL
            AND enrollment_token_hash = $3
            -- 期限も同じ条件へ入れる。読んでから更新するまでに期限が来ても、
            -- 更新の側で断れる。
            AND enrollment_token_expires_at > $6
          RETURNING ${DEVICE_COLUMNS}`,
        [
          workspaceId,
          deviceId,
          input.enrollmentTokenHash,
          input.publicKey,
          input.enrollments,
          input.enrolledAt,
        ],
      );
      const row = rows[0];
      // 0 行なら、同じトークンを使う別の要求が先に消費している。
      return row ? toDevice(row) : null;
    },

    async markRevoked(workspaceId, deviceId, revokedAt) {
      const rows = await db.query<DeviceRow>(
        `UPDATE devices
            SET state = 'revoked',
                revoked_at = $3,
                -- 失効させた端末の登録トークンは、未使用でも使えなくする。
                enrollment_token_hash = NULL,
                enrollment_token_expires_at = NULL,
                updated_at = now()
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
      return rows.map(toReceiptRecord);
    },

    async insertReceipt(workspaceId, input) {
      const rejected = input.outcome === 'rejected';
      const rows = await db.query<ReceiptRow>(
        `INSERT INTO device_event_receipts
           (workspace_id, device_id, sequence, request_id, received_at, device_time,
            clock_skew_seconds, sequence_step, attendance_event_id, business_date, outcome,
            event_type, rejection_code, rejection_message, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
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
          rejected ? null : input.attendanceEventId,
          rejected ? null : input.businessDate,
          input.outcome,
          rejected ? null : input.eventType,
          rejected ? input.rejection.code : null,
          rejected ? input.rejection.message : null,
          JSON.stringify(input.detail ?? {}),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('受信記録を保存できませんでした');
      return toReceipt(row);
    },
  };
}
