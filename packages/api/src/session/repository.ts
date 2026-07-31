import type { SessionObservationRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { BusinessDate, SessionObservationType } from '@staffweave/domain';

/**
 * まとめ送り 1 回分の受領記録。
 *
 * 観測は 1 回の要求から複数行できるため、冪等キーの一意性は観測行では保証できない。
 * 要求ごとに 1 行だけを持つこの記録が、同じ要求を二重に受け取らないことの正本になる。
 * 契約には出さず、サーバーの内部記録として扱う。
 */
export interface SessionObservationReceipt {
  id: string;
  workspaceId: string;
  deviceId: string;
  requestId: string;
  sequence: number;
  receivedAt: Date;
  /** 直前に受理した端末連番との差。1 なら欠落なし。 */
  sequenceStep: number;
  outcome: 'accepted' | 'rejected';
  accepted: number;
  skipped: number;
  detail: Record<string, unknown>;
}

/** 要求の冪等性を決める一意制約。競合したときに、他の一意制約と取り違えないため名前で見る。 */
export const SESSION_RECEIPT_REQUEST_CONSTRAINT = 'workstation_session_receipts_request_key';

export interface SessionObservationRepository {
  /** 同じ冪等キーで記録済みかどうか。まとめ送りの再送を判定する。 */
  countByRequestId(workspaceId: string, requestId: string): Promise<number>;
  /** 同じ冪等キーで受け取り済みかどうか。受理と拒否のどちらも残る。 */
  findReceiptByRequestId(
    workspaceId: string,
    requestId: string,
  ): Promise<SessionObservationReceipt | null>;
  insertReceipt(
    workspaceId: string,
    input: {
      deviceId: string;
      requestId: string;
      sequence: number;
      receivedAt: Date;
      sequenceStep: number;
      outcome: SessionObservationReceipt['outcome'];
      accepted: number;
      skipped: number;
      detail?: Record<string, unknown>;
    },
  ): Promise<SessionObservationReceipt>;
  /**
   * 0016 より前に保存された観測の再送互換にだけ使う。
   * 新しい要求の冪等性は受領記録の一意制約が正本であり、この照会には依存しない。
   */
  existsLegacyRequest(workspaceId: string, requestId: string): Promise<boolean>;
  insert(
    workspaceId: string,
    input: {
      employeeId: string;
      deviceId: string | null;
      observationType: SessionObservationType;
      occurredAt: Date;
      businessDate: BusinessDate;
      requestId: string;
      workstationName: string | null;
    },
  ): Promise<SessionObservationRecord>;
  listForDay(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<SessionObservationRecord[]>;
  listForRange(
    workspaceId: string,
    query: { employeeId?: string; from: string; to: string },
  ): Promise<SessionObservationRecord[]>;
}

interface ObservationRow {
  id: string;
  employee_id: string;
  observation_type: SessionObservationType;
  occurred_at: Date;
  recorded_at: Date;
  business_date: string;
  workstation_name: string | null;
}

interface ReceiptRow {
  id: string;
  workspace_id: string;
  device_id: string;
  request_id: string;
  sequence: number;
  received_at: Date;
  sequence_step: number;
  outcome: SessionObservationReceipt['outcome'];
  accepted: number;
  skipped: number;
  detail: Record<string, unknown>;
}

const COLUMNS = `id, employee_id, observation_type, occurred_at, recorded_at,
  business_date, workstation_name`;
const RECEIPT_COLUMNS = `id, workspace_id, device_id, request_id, sequence, received_at,
  sequence_step, outcome, accepted, skipped, detail`;

function toObservation(row: ObservationRow): SessionObservationRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    observationType: row.observation_type,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    businessDate: row.business_date,
    workstationName: row.workstation_name,
  };
}

function toReceipt(row: ReceiptRow): SessionObservationReceipt {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    deviceId: row.device_id,
    requestId: row.request_id,
    sequence: row.sequence,
    receivedAt: row.received_at,
    sequenceStep: row.sequence_step,
    outcome: row.outcome,
    accepted: row.accepted,
    skipped: row.skipped,
    detail: row.detail,
  };
}

export function createSessionObservationRepository(db: Queryable): SessionObservationRepository {
  return {
    async countByRequestId(workspaceId, requestId) {
      const rows = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM workstation_session_observations
          WHERE workspace_id = $1 AND request_id = $2`,
        [workspaceId, requestId],
      );
      return rows[0]?.count ?? 0;
    },

    async findReceiptByRequestId(workspaceId, requestId) {
      const rows = await db.query<ReceiptRow>(
        `SELECT ${RECEIPT_COLUMNS} FROM workstation_session_receipts
          WHERE workspace_id = $1 AND request_id = $2`,
        [workspaceId, requestId],
      );
      return rows[0] ? toReceipt(rows[0]) : null;
    },

    async insertReceipt(workspaceId, input) {
      // 一意制約に触れたことは競合が起きた証拠であり、ここでは隠さない。
      // 呼び出し側でトランザクションごと巻き戻し、先に確定した記録を読み直す。
      const rows = await db.query<ReceiptRow>(
        `INSERT INTO workstation_session_receipts
           (workspace_id, device_id, request_id, sequence, received_at,
            sequence_step, outcome, accepted, skipped, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING ${RECEIPT_COLUMNS}`,
        [
          workspaceId,
          input.deviceId,
          input.requestId,
          input.sequence,
          input.receivedAt,
          input.sequenceStep,
          input.outcome,
          input.accepted,
          input.skipped,
          JSON.stringify(input.detail ?? {}),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('受領記録を保存できませんでした');
      return toReceipt(row);
    },

    async existsLegacyRequest(workspaceId, requestId) {
      const rows = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM workstation_session_observations
            WHERE workspace_id = $1 AND request_id = $2
         ) AS exists`,
        [workspaceId, requestId],
      );
      return rows[0]?.exists ?? false;
    },

    async insert(workspaceId, input) {
      const rows = await db.query<ObservationRow>(
        `INSERT INTO workstation_session_observations
           (workspace_id, employee_id, device_id, observation_type, occurred_at,
            business_date, request_id, workstation_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.deviceId,
          input.observationType,
          input.occurredAt,
          input.businessDate,
          input.requestId,
          input.workstationName,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('観測を記録できませんでした');
      return toObservation(row);
    },

    async listForDay(workspaceId, employeeId, businessDate) {
      const rows = await db.query<ObservationRow>(
        `SELECT ${COLUMNS} FROM workstation_session_observations
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3
          ORDER BY occurred_at`,
        [workspaceId, employeeId, businessDate],
      );
      return rows.map(toObservation);
    },

    async listForRange(workspaceId, query) {
      const rows = await db.query<ObservationRow>(
        `SELECT ${COLUMNS} FROM workstation_session_observations
          WHERE workspace_id = $1
            AND business_date BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR employee_id = $4)
          ORDER BY business_date, occurred_at`,
        [workspaceId, query.from, query.to, query.employeeId ?? null],
      );
      return rows.map(toObservation);
    },
  };
}
