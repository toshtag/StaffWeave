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
  leave_minutes: number;
  absence_minutes: number;
  legal_inside_overtime_minutes: number | null;
  legal_overtime_minutes: number | null;
  legal_holiday_minutes: number | null;
  non_legal_holiday_minutes: number | null;
  night_overtime_minutes: number | null;
  night_holiday_minutes: number | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  before_schedule_minutes: number | null;
  after_schedule_minutes: number | null;
  deemed_minutes: number | null;
  counts_as_working_day: boolean;
  recognized_overtime_minutes: number | null;
  unapproved_overtime_minutes: number | null;
  approved_holiday_minutes: number | null;
  unapproved_holiday_minutes: number | null;
  basis: CalculationBasis;
}

const COLUMNS = `version, calculated_at, input_fingerprint, rule_version,
  attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
  within_schedule_minutes, outside_schedule_minutes, night_minutes,
  non_working_day_minutes, leave_minutes, absence_minutes,
  legal_inside_overtime_minutes, legal_overtime_minutes,
  legal_holiday_minutes, non_legal_holiday_minutes,
  night_overtime_minutes, night_holiday_minutes,
  late_minutes, early_leave_minutes, before_schedule_minutes, after_schedule_minutes,
  deemed_minutes,
  counts_as_working_day,
  recognized_overtime_minutes, unapproved_overtime_minutes,
  approved_holiday_minutes, unapproved_holiday_minutes, basis`;

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
    leaveMinutes: row.leave_minutes,
    absenceMinutes: row.absence_minutes,
    legalInsideOvertimeMinutes: row.legal_inside_overtime_minutes,
    legalOvertimeMinutes: row.legal_overtime_minutes,
    legalHolidayMinutes: row.legal_holiday_minutes,
    nonLegalHolidayMinutes: row.non_legal_holiday_minutes,
    nightOvertimeMinutes: row.night_overtime_minutes,
    nightHolidayMinutes: row.night_holiday_minutes,
    lateMinutes: row.late_minutes,
    earlyLeaveMinutes: row.early_leave_minutes,
    beforeScheduleMinutes: row.before_schedule_minutes,
    afterScheduleMinutes: row.after_schedule_minutes,
    deemedMinutes: row.deemed_minutes,
    countsAsWorkingDay: row.counts_as_working_day,
    recognizedOvertimeMinutes: row.recognized_overtime_minutes,
    unapprovedOvertimeMinutes: row.unapproved_overtime_minutes,
    approvedHolidayMinutes: row.approved_holiday_minutes,
    unapprovedHolidayMinutes: row.unapproved_holiday_minutes,
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
            non_working_day_minutes, leave_minutes, absence_minutes,
            legal_inside_overtime_minutes, legal_overtime_minutes,
            legal_holiday_minutes, non_legal_holiday_minutes,
            night_overtime_minutes, night_holiday_minutes,
            late_minutes, early_leave_minutes, before_schedule_minutes, after_schedule_minutes,
            deemed_minutes,
            counts_as_working_day,
            recognized_overtime_minutes, unapproved_overtime_minutes,
            approved_holiday_minutes, unapproved_holiday_minutes, basis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
                 $29, $30, $31, $32, $33::jsonb)
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
          result.leaveMinutes,
          result.absenceMinutes,
          result.legalInsideOvertimeMinutes,
          result.legalOvertimeMinutes,
          result.legalHolidayMinutes,
          result.nonLegalHolidayMinutes,
          result.nightOvertimeMinutes,
          result.nightHolidayMinutes,
          result.lateMinutes,
          result.earlyLeaveMinutes,
          result.beforeScheduleMinutes,
          result.afterScheduleMinutes,
          result.deemedMinutes,
          result.countsAsWorkingDay,
          result.recognizedOvertimeMinutes,
          result.unapprovedOvertimeMinutes,
          result.approvedHolidayMinutes,
          result.unapprovedHolidayMinutes,
          JSON.stringify(result.basis),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('計算結果を保存できませんでした');
      return toRecord(row);
    },
  };
}
