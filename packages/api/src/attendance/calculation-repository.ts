import type { AttendanceCalculationRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { BusinessDate, CalculationBasis, CalculationResult } from '@staffweave/domain';

/**
 * 計算結果の保存。
 * 入力が変わるたびに版を増やして追記し、過去の計算をたどれるようにする。
 */
export interface CalculationRepository {
  findLatest(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<AttendanceCalculationRecord | null>;

  insert(
    workspaceId: string,
    input: {
      employeeId: string;
      businessDate: BusinessDate;
      version: number;
      inputFingerprint: string;
      result: CalculationResult;
    },
  ): Promise<AttendanceCalculationRecord>;
}

interface CalculationRow {
  version: number;
  calculated_at: Date;
  input_fingerprint: string;
  rule_version: string;
  attended_minutes: number;
  worked_minutes: number;
  break_minutes: number;
  scheduled_minutes: number;
  within_schedule_minutes: number;
  outside_schedule_minutes: number;
  night_minutes: number;
  non_working_day_minutes: number;
  basis: CalculationBasis;
}

const COLUMNS = `version, calculated_at, input_fingerprint, rule_version,
  attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
  within_schedule_minutes, outside_schedule_minutes, night_minutes,
  non_working_day_minutes, basis`;

function toRecord(row: CalculationRow): AttendanceCalculationRecord {
  return {
    version: row.version,
    calculatedAt: row.calculated_at.toISOString(),
    inputFingerprint: row.input_fingerprint,
    ruleVersion: row.rule_version,
    attendedMinutes: row.attended_minutes,
    workedMinutes: row.worked_minutes,
    breakMinutes: row.break_minutes,
    scheduledMinutes: row.scheduled_minutes,
    withinScheduleMinutes: row.within_schedule_minutes,
    outsideScheduleMinutes: row.outside_schedule_minutes,
    nightMinutes: row.night_minutes,
    nonWorkingDayMinutes: row.non_working_day_minutes,
    basis: row.basis,
  };
}

export function createCalculationRepository(db: Queryable): CalculationRepository {
  return {
    async findLatest(workspaceId, employeeId, businessDate) {
      const rows = await db.query<CalculationRow>(
        `SELECT ${COLUMNS} FROM attendance_calculations
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3
          ORDER BY version DESC LIMIT 1`,
        [workspaceId, employeeId, businessDate],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async insert(workspaceId, input) {
      const { result } = input;
      const rows = await db.query<CalculationRow>(
        `INSERT INTO attendance_calculations
           (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
            attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
            within_schedule_minutes, outside_schedule_minutes, night_minutes,
            non_working_day_minutes, basis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
         RETURNING ${COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.businessDate,
          input.version,
          input.inputFingerprint,
          result.basis.ruleVersion,
          result.attendedMinutes,
          result.workedMinutes,
          result.breakMinutes,
          result.scheduledMinutes,
          result.withinScheduleMinutes,
          result.outsideScheduleMinutes,
          result.nightMinutes,
          result.nonWorkingDayMinutes,
          JSON.stringify(result.basis),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('計算結果を保存できませんでした');
      return toRecord(row);
    },
  };
}
