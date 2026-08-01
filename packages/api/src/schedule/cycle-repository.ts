import type {
  EmployeeWorkCycleRecord,
  LeaveTypeRecord,
  WorkCycleDayRecord,
  WorkCycleRecord,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { BusinessDate } from '@staffweave/domain';

/**
 * 休暇種別と勤務周期の永続化。
 * 勤務予定そのものとは別のライフサイクルを持つため、リポジトリを分ける。
 */
export interface WorkCycleRepository {
  listLeaveTypes(workspaceId: string): Promise<LeaveTypeRecord[]>;
  createLeaveType(
    workspaceId: string,
    input: { code: string; name: string; paid: boolean },
  ): Promise<LeaveTypeRecord>;

  listWorkCycles(workspaceId: string): Promise<WorkCycleRecord[]>;
  findWorkCycle(workspaceId: string, workCycleId: string): Promise<WorkCycleRecord | null>;
  createWorkCycle(
    workspaceId: string,
    input: {
      code: string;
      name: string;
      cycleLength: number;
      days: readonly WorkCycleDayRecord[];
    },
  ): Promise<WorkCycleRecord>;

  listAssignments(workspaceId: string, employeeId: string): Promise<EmployeeWorkCycleRecord[]>;
  findAssignment(
    workspaceId: string,
    employeeWorkCycleId: string,
  ): Promise<EmployeeWorkCycleRecord | null>;
  /** 割当に終了日を設定する。制度を切り替えるとき、次の割当と期間が重ならないようにする。 */
  endAssignment(
    workspaceId: string,
    employeeWorkCycleId: string,
    effectiveTo: BusinessDate,
  ): Promise<EmployeeWorkCycleRecord>;
  createAssignment(
    workspaceId: string,
    input: {
      employeeId: string;
      workCycleId: string;
      anchorDate: BusinessDate;
      effectiveFrom: BusinessDate;
      effectiveTo: BusinessDate | null;
    },
  ): Promise<EmployeeWorkCycleRecord>;
}

interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  created_at: Date;
}

interface CycleRow {
  id: string;
  code: string;
  name: string;
  cycle_length: number;
  created_at: Date;
}

interface CycleDayRow {
  work_cycle_id: string;
  position: number;
  day_type: WorkCycleDayRecord['dayType'];
  work_pattern_id: string | null;
}

interface AssignmentRow {
  id: string;
  employee_id: string;
  work_cycle_id: string;
  anchor_date: string;
  effective_from: string;
  effective_to: string | null;
}

function toLeaveType(row: LeaveTypeRow): LeaveTypeRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    paid: row.paid,
    createdAt: row.created_at.toISOString(),
  };
}

function toAssignment(row: AssignmentRow): EmployeeWorkCycleRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    workCycleId: row.work_cycle_id,
    anchorDate: row.anchor_date,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

export function createWorkCycleRepository(db: Queryable): WorkCycleRepository {
  async function daysOf(workspaceId: string, cycleIds: readonly string[]) {
    if (cycleIds.length === 0) return new Map<string, WorkCycleDayRecord[]>();
    const rows = await db.query<CycleDayRow>(
      `SELECT work_cycle_id, position, day_type, work_pattern_id
         FROM work_cycle_days
        WHERE workspace_id = $1 AND work_cycle_id = ANY($2::uuid[])
        ORDER BY position`,
      [workspaceId, [...cycleIds]],
    );
    const grouped = new Map<string, WorkCycleDayRecord[]>();
    for (const row of rows) {
      const list = grouped.get(row.work_cycle_id) ?? [];
      list.push({
        position: row.position,
        dayType: row.day_type,
        workPatternId: row.work_pattern_id,
      });
      grouped.set(row.work_cycle_id, list);
    }
    return grouped;
  }

  return {
    async listLeaveTypes(workspaceId) {
      const rows = await db.query<LeaveTypeRow>(
        'SELECT id, code, name, paid, created_at FROM leave_types WHERE workspace_id = $1 ORDER BY code',
        [workspaceId],
      );
      return rows.map(toLeaveType);
    },

    async createLeaveType(workspaceId, input) {
      const rows = await db.query<LeaveTypeRow>(
        `INSERT INTO leave_types (workspace_id, code, name, paid)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, paid, created_at`,
        [workspaceId, input.code, input.name, input.paid],
      );
      const row = rows[0];
      if (!row) throw new Error('休暇種別を登録できませんでした');
      return toLeaveType(row);
    },

    async listWorkCycles(workspaceId) {
      const rows = await db.query<CycleRow>(
        'SELECT id, code, name, cycle_length, created_at FROM work_cycles WHERE workspace_id = $1 ORDER BY code',
        [workspaceId],
      );
      const grouped = await daysOf(
        workspaceId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        cycleLength: row.cycle_length,
        days: grouped.get(row.id) ?? [],
        createdAt: row.created_at.toISOString(),
      }));
    },

    async findWorkCycle(workspaceId, workCycleId) {
      const rows = await db.query<CycleRow>(
        'SELECT id, code, name, cycle_length, created_at FROM work_cycles WHERE workspace_id = $1 AND id = $2',
        [workspaceId, workCycleId],
      );
      const row = rows[0];
      if (!row) return null;
      const grouped = await daysOf(workspaceId, [row.id]);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        cycleLength: row.cycle_length,
        days: grouped.get(row.id) ?? [],
        createdAt: row.created_at.toISOString(),
      };
    },

    async createWorkCycle(workspaceId, input) {
      const rows = await db.query<CycleRow>(
        `INSERT INTO work_cycles (workspace_id, code, name, cycle_length)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, cycle_length, created_at`,
        [workspaceId, input.code, input.name, input.cycleLength],
      );
      const row = rows[0];
      if (!row) throw new Error('勤務周期を登録できませんでした');

      for (const day of input.days) {
        await db.query(
          `INSERT INTO work_cycle_days
             (workspace_id, work_cycle_id, position, day_type, work_pattern_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, row.id, day.position, day.dayType, day.workPatternId],
        );
      }

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        cycleLength: row.cycle_length,
        days: [...input.days],
        createdAt: row.created_at.toISOString(),
      };
    },

    async listAssignments(workspaceId, employeeId) {
      const rows = await db.query<AssignmentRow>(
        `SELECT id, employee_id, work_cycle_id, anchor_date, effective_from, effective_to
           FROM employee_work_cycles
          WHERE workspace_id = $1 AND employee_id = $2
          -- 期間が重ならないことは制約で決めているが、並び順まで開始日だけに委ねない。
          ORDER BY effective_from, work_cycle_id`,
        [workspaceId, employeeId],
      );
      return rows.map(toAssignment);
    },

    async findAssignment(workspaceId, employeeWorkCycleId) {
      const rows = await db.query<AssignmentRow>(
        `SELECT id, employee_id, work_cycle_id, anchor_date, effective_from, effective_to
           FROM employee_work_cycles
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, employeeWorkCycleId],
      );
      const row = rows[0];
      return row ? toAssignment(row) : null;
    },

    async endAssignment(workspaceId, employeeWorkCycleId, effectiveTo) {
      const rows = await db.query<AssignmentRow>(
        `UPDATE employee_work_cycles
            SET effective_to = $3
          WHERE workspace_id = $1 AND id = $2
          RETURNING id, employee_id, work_cycle_id, anchor_date, effective_from, effective_to`,
        [workspaceId, employeeWorkCycleId, effectiveTo],
      );
      const row = rows[0];
      if (!row) throw new Error('勤務周期の割当を更新できませんでした');
      return toAssignment(row);
    },

    async createAssignment(workspaceId, input) {
      const rows = await db.query<AssignmentRow>(
        `INSERT INTO employee_work_cycles
           (workspace_id, employee_id, work_cycle_id, anchor_date, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, employee_id, work_cycle_id, anchor_date, effective_from, effective_to`,
        [
          workspaceId,
          input.employeeId,
          input.workCycleId,
          input.anchorDate,
          input.effectiveFrom,
          input.effectiveTo,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('勤務周期を割り当てられませんでした');
      return toAssignment(row);
    },
  };
}
