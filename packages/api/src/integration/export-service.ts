import type { Queryable } from '@staffweave/db';
import type { EmployeeVisibility } from '@staffweave/domain';
import { isBusinessDate, toCsv } from '@staffweave/domain';
import { employeeVisibilityCondition } from '../shared/employee-visibility.js';
import { invalidRequest } from '../shared/errors.js';

/**
 * 外部システムへ渡すための出力。
 *
 * 特定の給与ソフトの形式には寄せず、汎用の列で出す。
 * 取り込む側が必要な列だけを選べるよう、意味の分かる列名を使う。
 *
 * 件数が多くなるため、閲覧範囲は SQL の条件として渡す。
 * 全件を読み込んでから捨てる形にすると、絞り込みを忘れたときに気付けない。
 */

export interface ExportService {
  attendanceCsv(
    workspaceId: string,
    visibility: EmployeeVisibility,
    query: { from: string; to: string },
  ): Promise<string>;
  payrollCsv(
    workspaceId: string,
    visibility: EmployeeVisibility,
    query: { period: string },
  ): Promise<string>;
}

function requireDate(value: string, field: string): string {
  if (!isBusinessDate(value)) {
    throw invalidRequest([{ field, message: '日付の形式が正しくありません' }]);
  }
  return value;
}

export function createExportService(db: Queryable): ExportService {
  return {
    async attendanceCsv(workspaceId, visibility, query) {
      const from = requireDate(query.from, 'from');
      const to = requireDate(query.to, 'to');
      if (from > to) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }

      const visible = employeeVisibilityCondition(visibility, {
        employeeIdExpression: 'employees.id',
        workspaceIdExpression: 'employees.workspace_id',
        firstParameterIndex: 4,
      });

      const rows = await db.query<{
        employee_number: string;
        display_name: string;
        business_date: string;
        day_type: string | null;
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
        request_state: string | null;
        closing_state: string | null;
      }>(
        `SELECT employees.employee_number,
                employees.display_name,
                calculations.business_date,
                schedules.day_type,
                calculations.attended_minutes,
                calculations.worked_minutes,
                calculations.break_minutes,
                calculations.scheduled_minutes,
                calculations.within_schedule_minutes,
                calculations.outside_schedule_minutes,
                calculations.night_minutes,
                calculations.non_working_day_minutes,
                calculations.leave_minutes,
                calculations.absence_minutes,
                requests.state AS request_state,
                closings.state AS closing_state
           FROM attendance_calculations AS calculations
           JOIN employees
             ON employees.id = calculations.employee_id
            AND employees.workspace_id = calculations.workspace_id
           LEFT JOIN work_schedules AS schedules
             ON schedules.workspace_id = calculations.workspace_id
            AND schedules.employee_id = calculations.employee_id
            AND schedules.business_date = calculations.business_date
           LEFT JOIN daily_attendance_requests AS requests
             ON requests.workspace_id = calculations.workspace_id
            AND requests.employee_id = calculations.employee_id
            AND requests.business_date = calculations.business_date
           LEFT JOIN monthly_closings AS closings
             ON closings.workspace_id = calculations.workspace_id
            AND closings.employee_id = calculations.employee_id
            AND closings.period = date_trunc('month', calculations.business_date)::date
          WHERE calculations.workspace_id = $1
            AND calculations.business_date BETWEEN $2 AND $3
            AND ${visible.sql}
            AND calculations.version = (
              SELECT max(latest.version) FROM attendance_calculations AS latest
               WHERE latest.workspace_id = calculations.workspace_id
                 AND latest.employee_id = calculations.employee_id
                 AND latest.business_date = calculations.business_date
            )
          ORDER BY employees.employee_number, calculations.business_date`,
        [workspaceId, from, to, ...visible.parameters],
      );

      return toCsv(
        [
          'employee_number',
          'display_name',
          'business_date',
          'day_type',
          'attended_minutes',
          'worked_minutes',
          'break_minutes',
          'scheduled_minutes',
          'within_schedule_minutes',
          'outside_schedule_minutes',
          'night_minutes',
          'non_working_day_minutes',
          'leave_minutes',
          'absence_minutes',
          'request_state',
          'closing_state',
        ],
        rows.map((row) => [
          row.employee_number,
          row.display_name,
          row.business_date,
          row.day_type ?? '',
          row.attended_minutes,
          row.worked_minutes,
          row.break_minutes,
          row.scheduled_minutes,
          row.within_schedule_minutes,
          row.outside_schedule_minutes,
          row.night_minutes,
          row.non_working_day_minutes,
          row.leave_minutes,
          row.absence_minutes,
          row.request_state ?? '',
          row.closing_state ?? '',
        ]),
      );
    },

    async payrollCsv(workspaceId, visibility, query) {
      const period = requireDate(query.period, 'period');

      const visible = employeeVisibilityCondition(visibility, {
        employeeIdExpression: 'employees.id',
        workspaceIdExpression: 'employees.workspace_id',
        firstParameterIndex: 3,
      });

      const rows = await db.query<{
        employee_number: string;
        display_name: string;
        worked_minutes: number;
        outside_schedule_minutes: number;
        night_minutes: number;
        non_working_day_minutes: number;
        leave_minutes: number;
        absence_minutes: number;
        working_days: number;
        closing_state: string | null;
      }>(
        `SELECT employees.employee_number,
                employees.display_name,
                coalesce(sum(latest.worked_minutes), 0)::int AS worked_minutes,
                coalesce(sum(latest.outside_schedule_minutes), 0)::int
                  AS outside_schedule_minutes,
                coalesce(sum(latest.night_minutes), 0)::int AS night_minutes,
                coalesce(sum(latest.non_working_day_minutes), 0)::int
                  AS non_working_day_minutes,
                coalesce(sum(latest.leave_minutes), 0)::int AS leave_minutes,
                coalesce(sum(latest.absence_minutes), 0)::int AS absence_minutes,
                count(*) FILTER (WHERE latest.worked_minutes > 0)::int AS working_days,
                max(closings.state) AS closing_state
           FROM employees
           LEFT JOIN LATERAL (
             SELECT DISTINCT ON (calculations.business_date)
                    calculations.business_date,
                    calculations.worked_minutes,
                    calculations.outside_schedule_minutes,
                    calculations.night_minutes,
                    calculations.non_working_day_minutes,
                    calculations.leave_minutes,
                    calculations.absence_minutes
               FROM attendance_calculations AS calculations
              WHERE calculations.workspace_id = employees.workspace_id
                AND calculations.employee_id = employees.id
                AND calculations.business_date >= $2::date
                AND calculations.business_date < ($2::date + interval '1 month')
              ORDER BY calculations.business_date, calculations.version DESC
           ) AS latest ON true
           LEFT JOIN monthly_closings AS closings
             ON closings.workspace_id = employees.workspace_id
            AND closings.employee_id = employees.id
            AND closings.period = $2::date
          WHERE employees.workspace_id = $1
            AND ${visible.sql}
          GROUP BY employees.employee_number, employees.display_name
          ORDER BY employees.employee_number`,
        [workspaceId, period, ...visible.parameters],
      );

      return toCsv(
        [
          'period',
          'employee_number',
          'display_name',
          'working_days',
          'worked_minutes',
          'outside_schedule_minutes',
          'night_minutes',
          'non_working_day_minutes',
          'leave_minutes',
          'absence_minutes',
          'closing_state',
        ],
        rows.map((row) => [
          period,
          row.employee_number,
          row.display_name,
          row.working_days,
          row.worked_minutes,
          row.outside_schedule_minutes,
          row.night_minutes,
          row.non_working_day_minutes,
          row.leave_minutes,
          row.absence_minutes,
          row.closing_state ?? 'open',
        ]),
      );
    },
  };
}
