import type {
  LeaveLedgerEntryRecord,
  LeaveTypeSettingsRecord,
  UpdateLeaveTypeRequest,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';

/**
 * 休暇台帳の読み書き。
 *
 * 残数は保存しない。記録を積むだけで、残数はドメインが台帳から組み立てる。
 * ここに合計を持たせると、合計と記録が食い違ったときに、
 * どちらが正しいのかを決められなくなる。
 */
export interface LeaveRepository {
  listLeaveTypes(workspaceId: string): Promise<LeaveTypeSettingsRecord[]>;
  findLeaveType(workspaceId: string, leaveTypeId: string): Promise<LeaveTypeSettingsRecord | null>;
  updateLeaveType(
    workspaceId: string,
    leaveTypeId: string,
    input: UpdateLeaveTypeRequest,
  ): Promise<LeaveTypeSettingsRecord | null>;

  listEntries(
    workspaceId: string,
    query: { employeeId: string; leaveTypeId?: string },
  ): Promise<LeaveLedgerEntryRecord[]>;
  findEntry(workspaceId: string, entryId: string): Promise<LeaveLedgerEntryRecord | null>;
  addEntry(workspaceId: string, input: NewLeaveLedgerEntry): Promise<LeaveLedgerEntryRecord>;
}

export interface NewLeaveLedgerEntry {
  employeeId: string;
  leaveTypeId: string;
  entryType: LeaveLedgerEntryRecord['entryType'];
  minutes: number;
  effectiveOn: string;
  expiresOn?: string | null;
  reversesEntryId?: string | null;
  requestId?: string | null;
  reason?: string | null;
  createdByUserId?: string | null;
}

interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  unit_minutes: number | null;
  day_minutes: number | null;
  expires_after_months: number | null;
  active: boolean;
  created_at: Date;
}

const LEAVE_TYPE_COLUMNS =
  'id, code, name, paid, unit_minutes, day_minutes, expires_after_months, active, created_at';

function toLeaveType(row: LeaveTypeRow): LeaveTypeSettingsRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    paid: row.paid,
    unitMinutes: row.unit_minutes,
    dayMinutes: row.day_minutes,
    expiresAfterMonths: row.expires_after_months,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

interface EntryRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  entry_type: LeaveLedgerEntryRecord['entryType'];
  minutes: number;
  effective_on: string;
  expires_on: string | null;
  reverses_entry_id: string | null;
  request_id: string | null;
  reason: string | null;
  created_at: Date;
  created_by_user_id: string | null;
}

const ENTRY_COLUMNS = `id, employee_id, leave_type_id, entry_type, minutes, effective_on,
  expires_on, reverses_entry_id, request_id, reason, created_at, created_by_user_id`;

function toEntry(row: EntryRow): LeaveLedgerEntryRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    entryType: row.entry_type,
    minutes: row.minutes,
    effectiveOn: row.effective_on,
    expiresOn: row.expires_on,
    reversesEntryId: row.reverses_entry_id,
    requestId: row.request_id,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
  };
}

export function createLeaveRepository(db: Queryable): LeaveRepository {
  return {
    async listLeaveTypes(workspaceId) {
      const rows = await db.query<LeaveTypeRow>(
        `SELECT ${LEAVE_TYPE_COLUMNS} FROM leave_types WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toLeaveType);
    },

    async findLeaveType(workspaceId, leaveTypeId) {
      const rows = await db.query<LeaveTypeRow>(
        `SELECT ${LEAVE_TYPE_COLUMNS} FROM leave_types WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, leaveTypeId],
      );
      const row = rows[0];
      return row ? toLeaveType(row) : null;
    },

    async updateLeaveType(workspaceId, leaveTypeId, input) {
      // 与えられた項目だけを書き換える。触れなかった設定を既定値へ戻さない。
      const rows = await db.query<LeaveTypeRow>(
        `UPDATE leave_types
            SET name = COALESCE($3, name),
                paid = COALESCE($4, paid),
                unit_minutes = CASE WHEN $5::boolean THEN $6 ELSE unit_minutes END,
                day_minutes = CASE WHEN $7::boolean THEN $8 ELSE day_minutes END,
                expires_after_months =
                  CASE WHEN $9::boolean THEN $10 ELSE expires_after_months END,
                active = COALESCE($11, active)
          WHERE workspace_id = $1 AND id = $2
        RETURNING ${LEAVE_TYPE_COLUMNS}`,
        [
          workspaceId,
          leaveTypeId,
          input.name ?? null,
          input.paid ?? null,
          'unitMinutes' in input,
          input.unitMinutes ?? null,
          'dayMinutes' in input,
          input.dayMinutes ?? null,
          'expiresAfterMonths' in input,
          input.expiresAfterMonths ?? null,
          input.active ?? null,
        ],
      );
      const row = rows[0];
      return row ? toLeaveType(row) : null;
    },

    async listEntries(workspaceId, query) {
      const rows = await db.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM leave_ledger_entries
          WHERE workspace_id = $1 AND employee_id = $2
            AND ($3::uuid IS NULL OR leave_type_id = $3)
          ORDER BY effective_on, created_at, id`,
        [workspaceId, query.employeeId, query.leaveTypeId ?? null],
      );
      return rows.map(toEntry);
    },

    async findEntry(workspaceId, entryId) {
      const rows = await db.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM leave_ledger_entries WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, entryId],
      );
      const row = rows[0];
      return row ? toEntry(row) : null;
    },

    async addEntry(workspaceId, input) {
      const rows = await db.query<EntryRow>(
        `INSERT INTO leave_ledger_entries
           (workspace_id, employee_id, leave_type_id, entry_type, minutes, effective_on,
            expires_on, reverses_entry_id, request_id, reason, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${ENTRY_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.leaveTypeId,
          input.entryType,
          input.minutes,
          input.effectiveOn,
          input.expiresOn ?? null,
          input.reversesEntryId ?? null,
          input.requestId ?? null,
          input.reason ?? null,
          input.createdByUserId ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('台帳へ記録できませんでした');
      return toEntry(row);
    },
  };
}
