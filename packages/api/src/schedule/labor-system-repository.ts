import type {
  CreateLaborSystemAssignmentRequest,
  LaborSystemAssignmentRecord,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';

/**
 * 労働形態の割当。
 *
 * 制度ごとの値は事業者が決める。製品は既定値を持たない。
 * 必要な値がそろわない割当は DB の制約が断る。
 */
export interface LaborSystemRepository {
  list(workspaceId: string, employeeId: string): Promise<LaborSystemAssignmentRecord[]>;
  /** その業務日に効いている割当。無ければ null。 */
  findForDate(
    workspaceId: string,
    employeeId: string,
    businessDate: string,
  ): Promise<LaborSystemAssignmentRecord | null>;
  create(
    workspaceId: string,
    input: CreateLaborSystemAssignmentRequest & { createdByUserId: string },
  ): Promise<LaborSystemAssignmentRecord>;
  end(
    workspaceId: string,
    assignmentId: string,
    effectiveTo: string,
  ): Promise<LaborSystemAssignmentRecord | null>;
}

interface Row {
  id: string;
  employee_id: string;
  system_type: LaborSystemAssignmentRecord['systemType'];
  effective_from: string;
  effective_to: string | null;
  settlement_months: number | null;
  settlement_starts_on: string | null;
  settlement_basis: LaborSystemAssignmentRecord['settlementBasis'];
  settlement_total_minutes: number | null;
  core_start_minutes: number | null;
  core_end_minutes: number | null;
  flexible_start_minutes: number | null;
  flexible_end_minutes: number | null;
  deemed_minutes: number | null;
  created_at: Date;
}

const COLUMNS = `id, employee_id, system_type, effective_from, effective_to,
  settlement_months, settlement_starts_on, settlement_basis, settlement_total_minutes,
  core_start_minutes, core_end_minutes, flexible_start_minutes, flexible_end_minutes,
  deemed_minutes, created_at`;

function toRecord(row: Row): LaborSystemAssignmentRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    systemType: row.system_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    settlementMonths: row.settlement_months,
    settlementStartsOn: row.settlement_starts_on,
    settlementBasis: row.settlement_basis,
    settlementTotalMinutes: row.settlement_total_minutes,
    coreStartMinutes: row.core_start_minutes,
    coreEndMinutes: row.core_end_minutes,
    flexibleStartMinutes: row.flexible_start_minutes,
    flexibleEndMinutes: row.flexible_end_minutes,
    deemedMinutes: row.deemed_minutes,
    createdAt: row.created_at.toISOString(),
  };
}

export function createLaborSystemRepository(db: Queryable): LaborSystemRepository {
  return {
    async list(workspaceId, employeeId) {
      const rows = await db.query<Row>(
        `SELECT ${COLUMNS} FROM labor_system_assignments
          WHERE workspace_id = $1 AND employee_id = $2
          ORDER BY effective_from DESC`,
        [workspaceId, employeeId],
      );
      return rows.map(toRecord);
    },

    async findForDate(workspaceId, employeeId, businessDate) {
      const rows = await db.query<Row>(
        `SELECT ${COLUMNS} FROM labor_system_assignments
          WHERE workspace_id = $1 AND employee_id = $2
            AND effective_from <= $3::date
            AND (effective_to IS NULL OR effective_to >= $3::date)
          LIMIT 1`,
        [workspaceId, employeeId, businessDate],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async create(workspaceId, input) {
      const rows = await db.query<Row>(
        `INSERT INTO labor_system_assignments
           (workspace_id, employee_id, system_type, effective_from, effective_to,
            settlement_months, settlement_starts_on, settlement_basis, settlement_total_minutes,
            core_start_minutes, core_end_minutes, flexible_start_minutes, flexible_end_minutes,
            deemed_minutes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING ${COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.systemType,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.settlementMonths ?? null,
          input.settlementStartsOn ?? null,
          input.settlementBasis ?? null,
          input.settlementTotalMinutes ?? null,
          input.coreStartMinutes ?? null,
          input.coreEndMinutes ?? null,
          input.flexibleStartMinutes ?? null,
          input.flexibleEndMinutes ?? null,
          input.deemedMinutes ?? null,
          input.createdByUserId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('労働形態の割当を作成できませんでした');
      return toRecord(row);
    },

    async end(workspaceId, assignmentId, effectiveTo) {
      const rows = await db.query<Row>(
        `UPDATE labor_system_assignments
            SET effective_to = $3::date
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${COLUMNS}`,
        [workspaceId, assignmentId, effectiveTo],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },
  };
}
