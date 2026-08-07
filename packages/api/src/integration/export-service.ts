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

      // 日次の出力は行ごとの業務日で判断する。配属されていた日の行だけを出す。
      const visible = employeeVisibilityCondition(visibility, {
        employeeIdExpression: 'employees.id',
        workspaceIdExpression: 'employees.workspace_id',
        period: {
          fromExpression: 'calculations.business_date',
          toExpression: 'calculations.business_date',
        },
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

      // 月次の出力は対象月のいずれかの日で判断する。月の一部でも配属されていれば出す。
      const visible = employeeVisibilityCondition(visibility, {
        employeeIdExpression: 'employees.id',
        workspaceIdExpression: 'employees.workspace_id',
        period: {
          fromExpression: '$2::date',
          toExpression: "($2::date + interval '1 month' - interval '1 day')::date",
        },
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
        recognized_overtime_minutes: number | null;
        unapproved_overtime_minutes: number | null;
        approved_holiday_minutes: number | null;
        unapproved_holiday_minutes: number | null;
        closing_state: string | null;
        snapshot_sequence: number | null;
        closed_at: Date | null;
      }>(
        // 締めた月は、締めた時点で固めた値を出す。
        // いま日次を足し直すと、締めたあとの訂正が混ざり、
        // すでに給与へ渡した値と食い違う。締めを解除した月は live の値へ戻る。
        `SELECT employees.employee_number,
                employees.display_name,
                coalesce(snapshot.worked_minutes,
                         sum(latest.worked_minutes)::int, 0) AS worked_minutes,
                coalesce(snapshot.outside_schedule_minutes,
                         sum(latest.outside_schedule_minutes)::int, 0)
                  AS outside_schedule_minutes,
                coalesce(snapshot.night_minutes,
                         sum(latest.night_minutes)::int, 0) AS night_minutes,
                coalesce(snapshot.non_working_day_minutes,
                         sum(latest.non_working_day_minutes)::int, 0)
                  AS non_working_day_minutes,
                coalesce(snapshot.leave_minutes,
                         sum(latest.leave_minutes)::int, 0) AS leave_minutes,
                coalesce(snapshot.absence_minutes,
                         sum(latest.absence_minutes)::int, 0) AS absence_minutes,
                -- 出勤日数は、実労働があるだけでは数えない。勤務区分が
                -- 「数えない」と決めた日は外す。
                coalesce(snapshot.worked_days,
                         count(*) FILTER (
                           WHERE latest.worked_minutes > 0 AND latest.counts_as_working_day
                         )::int, 0)
                  AS working_days,
                -- 認定した分と、認定の外に出た分。
                -- 1 日でも未設定の日があれば、その月の合計は出さない。
                -- 0 にすると「認定した残業が 0 分だった」と読めてしまう。
                coalesce(
                  snapshot.recognized_overtime_minutes,
                  CASE WHEN count(*) FILTER (
                         WHERE latest.business_date IS NOT NULL
                           AND latest.recognized_overtime_minutes IS NULL) > 0
                       THEN NULL
                       ELSE coalesce(sum(latest.recognized_overtime_minutes)::int, 0) END
                ) AS recognized_overtime_minutes,
                coalesce(
                  snapshot.unapproved_overtime_minutes,
                  CASE WHEN count(*) FILTER (
                         WHERE latest.business_date IS NOT NULL
                           AND latest.unapproved_overtime_minutes IS NULL) > 0
                       THEN NULL
                       ELSE coalesce(sum(latest.unapproved_overtime_minutes)::int, 0) END
                ) AS unapproved_overtime_minutes,
                coalesce(snapshot.approved_holiday_minutes,
                         sum(latest.approved_holiday_minutes)::int, 0)
                  AS approved_holiday_minutes,
                coalesce(snapshot.unapproved_holiday_minutes,
                         sum(latest.unapproved_holiday_minutes)::int, 0)
                  AS unapproved_holiday_minutes,
                max(closings.state) AS closing_state,
                snapshot.sequence AS snapshot_sequence,
                snapshot.closed_at
           FROM employees
           LEFT JOIN LATERAL (
             SELECT DISTINCT ON (calculations.business_date)
                    calculations.business_date,
                    calculations.worked_minutes,
                    calculations.outside_schedule_minutes,
                    calculations.night_minutes,
                    calculations.non_working_day_minutes,
                    calculations.leave_minutes,
                    calculations.absence_minutes,
                    calculations.counts_as_working_day,
                    calculations.recognized_overtime_minutes,
                    calculations.unapproved_overtime_minutes,
                    calculations.approved_holiday_minutes,
                    calculations.unapproved_holiday_minutes
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
           LEFT JOIN LATERAL (
             SELECT snapshots.sequence, snapshots.closed_at, snapshots.worked_minutes,
                    snapshots.outside_schedule_minutes, snapshots.night_minutes,
                    snapshots.non_working_day_minutes, snapshots.leave_minutes,
                    snapshots.absence_minutes, snapshots.worked_days,
                    snapshots.recognized_overtime_minutes,
                    snapshots.unapproved_overtime_minutes,
                    snapshots.approved_holiday_minutes,
                    snapshots.unapproved_holiday_minutes
               FROM monthly_closing_snapshots AS snapshots
              WHERE snapshots.workspace_id = employees.workspace_id
                AND snapshots.employee_id = employees.id
                AND snapshots.period = $2::date
                -- 締めを解除した月は live の値へ戻る。固めた値は残るが、出さない。
                AND closings.state = 'closed'
              ORDER BY snapshots.sequence DESC
              LIMIT 1
           ) AS snapshot ON true
          WHERE employees.workspace_id = $1
            AND ${visible.sql}
          GROUP BY employees.employee_number, employees.display_name,
                   snapshot.sequence, snapshot.closed_at, snapshot.worked_minutes,
                   snapshot.outside_schedule_minutes, snapshot.night_minutes,
                   snapshot.non_working_day_minutes, snapshot.leave_minutes,
                   snapshot.absence_minutes, snapshot.worked_days,
                   snapshot.recognized_overtime_minutes,
                   snapshot.unapproved_overtime_minutes,
                   snapshot.approved_holiday_minutes,
                   snapshot.unapproved_holiday_minutes
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
          // 既にある列の並びは変えない。取り込む側の設定を壊さないよう、後ろへ足す。
          'snapshot_sequence',
          'closed_at',
          'recognized_overtime_minutes',
          'unapproved_overtime_minutes',
          'approved_holiday_minutes',
          'unapproved_holiday_minutes',
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
          row.snapshot_sequence ?? '',
          row.closed_at === null ? '' : row.closed_at.toISOString(),
          // 未設定は空欄にする。0 と書くと、計算した結果 0 分だったと読めてしまう。
          row.recognized_overtime_minutes ?? '',
          row.unapproved_overtime_minutes ?? '',
          row.approved_holiday_minutes ?? '',
          row.unapproved_holiday_minutes ?? '',
        ]),
      );
    },
  };
}
