import type { AttendanceEventRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type {
  AttendanceEventType,
  ClosingDayState,
  CorrectionAction,
  DailyTotals,
  MonthlySummary,
} from '@staffweave/domain';

/**
 * 月次の読み書き。
 *
 * 集計そのものはドメインが行う。ここは「その月に属する日次の最新版」を集めるだけにする。
 * SQL で合計すると、未設定を 0 として足すかどうかの判断が SQL の中へ散る。
 */
export interface MonthlyRepository {
  /** その月に属する日次の最新版。締めた値と突き合わせるため、版も返す。 */
  listDailyTotals(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<{ totals: DailyTotals[]; versions: Record<string, number> }>;

  /**
   * その月の打刻を、業務日ごとにまとめて返す。
   *
   * 修正も含めた生の記録を返し、どれが有効かの判断はドメインへ任せる。
   * SQL で有効・無効を決めると、日次の画面と締め前の確認が別々の答えを出しうる。
   */
  listMonthEvents(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<Map<string, AttendanceEventRecord[]>>;

  /** その月の申請の状態。業務日ごとに 1 件。 */
  listMonthRequestStates(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<Map<string, ClosingDayState['requestState']>>;

  /** その月の締めの回数。締め直すたびに増える。 */
  nextSnapshotSequence(workspaceId: string, employeeId: string, period: string): Promise<number>;

  insertSnapshot(workspaceId: string, input: NewMonthlySnapshot): Promise<MonthlySnapshotRow>;

  /** いちばん新しい締めの記録。締めていなければ null。 */
  findLatestSnapshot(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<MonthlySnapshotRow | null>;

  /** その月の締めの状態。締めの記録が無ければ null。 */
  findClosingState(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<'open' | 'closed' | null>;

  /** 対象月の従業員。名前は一覧に出すため一緒に引く。 */
  listEmployeesForPeriod(
    workspaceId: string,
    employeeId?: string,
  ): Promise<{ id: string; employeeNumber: string; displayName: string }[]>;

  /**
   * 計算する意味のある日。
   *
   * 打刻も予定も過去の計算も無い日は、やり直しても何も出ない。
   * それでも計算を作ると、空の日の行が人数ぶん積み上がり、
   * 「計算がある日」が「働いた日」を意味しなくなる。
   */
  listDatesWithData(
    workspaceId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<Set<string>>;

  /** その日を含む月が締められているか。 */
  listClosedDates(
    workspaceId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<Set<string>>;
}

export interface NewMonthlySnapshot {
  employeeId: string;
  period: string;
  sequence: number;
  closedByUserId: string | null;
  dayVersions: Record<string, number>;
  summary: MonthlySummary;
}

export interface MonthlySnapshotRow {
  sequence: number;
  closedAt: string;
  closedByUserId: string | null;
  summary: MonthlySummary;
}

interface AttendanceEventRow {
  id: string;
  employee_id: string;
  event_type: AttendanceEventType;
  occurred_at: Date;
  recorded_at: Date;
  business_date: string;
  source: AttendanceEventRecord['source'];
  corrects_event_id: string | null;
  correction_action: CorrectionAction | null;
  correction_reason: string | null;
}

const EVENT_COLUMNS = `id, employee_id, event_type, occurred_at, recorded_at, business_date,
  source, corrects_event_id, correction_action, correction_reason`;

function toEvent(row: AttendanceEventRow): AttendanceEventRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    businessDate: row.business_date,
    source: row.source,
    correctsEventId: row.corrects_event_id,
    correctionAction: row.correction_action,
    correctionReason: row.correction_reason,
  };
}

const TOTALS_COLUMNS = `attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
  within_schedule_minutes, outside_schedule_minutes, night_minutes, non_working_day_minutes,
  leave_minutes, absence_minutes, legal_inside_overtime_minutes, legal_overtime_minutes,
  legal_holiday_minutes, non_legal_holiday_minutes, night_overtime_minutes,
  night_holiday_minutes, late_minutes, early_leave_minutes, deemed_minutes`;

interface TotalsRow {
  business_date: string;
  version: number;
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
  deemed_minutes: number | null;
}

function toDailyTotals(row: TotalsRow): DailyTotals {
  return {
    businessDate: row.business_date,
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
    deemedMinutes: row.deemed_minutes,
  };
}

interface SnapshotRow extends TotalsRow {
  sequence: number;
  closed_at: Date;
  closed_by_user_id: string | null;
  period: string;
  counted_days: number;
  worked_days: number;
  leave_days: number;
}

function toSnapshot(row: SnapshotRow): MonthlySnapshotRow {
  const { businessDate: _ignored, ...totals } = toDailyTotals(row);
  return {
    sequence: row.sequence,
    closedAt: row.closed_at.toISOString(),
    closedByUserId: row.closed_by_user_id,
    summary: {
      period: row.period,
      ...totals,
      workedDays: row.worked_days,
      leaveDays: row.leave_days,
      countedDays: row.counted_days,
    },
  };
}

export function createMonthlyRepository(db: Queryable): MonthlyRepository {
  return {
    async listDailyTotals(workspaceId, employeeId, period) {
      // 日ごとに最新の版だけを採る。版を重ねているため、そのまま足すと二重になる。
      const rows = await db.query<TotalsRow>(
        `SELECT DISTINCT ON (business_date) business_date, version, ${TOTALS_COLUMNS}
           FROM attendance_calculations
          WHERE workspace_id = $1 AND employee_id = $2
            AND business_date >= $3::date
            AND business_date < ($3::date + interval '1 month')
          ORDER BY business_date, version DESC`,
        [workspaceId, employeeId, period],
      );

      const versions: Record<string, number> = {};
      for (const row of rows) versions[row.business_date] = row.version;
      return { totals: rows.map(toDailyTotals), versions };
    },

    async listMonthEvents(workspaceId, employeeId, period) {
      const rows = await db.query<AttendanceEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM attendance_events
          WHERE workspace_id = $1 AND employee_id = $2
            AND business_date >= $3::date
            AND business_date < ($3::date + interval '1 month')
          ORDER BY business_date, recorded_at, id`,
        [workspaceId, employeeId, period],
      );

      const byDate = new Map<string, AttendanceEventRecord[]>();
      for (const row of rows) {
        const list = byDate.get(row.business_date) ?? [];
        list.push(toEvent(row));
        byDate.set(row.business_date, list);
      }
      return byDate;
    },

    async listMonthRequestStates(workspaceId, employeeId, period) {
      const rows = await db.query<{
        business_date: string;
        state: ClosingDayState['requestState'];
      }>(
        `SELECT business_date, state FROM daily_attendance_requests
          WHERE workspace_id = $1 AND employee_id = $2
            AND business_date >= $3::date
            AND business_date < ($3::date + interval '1 month')`,
        [workspaceId, employeeId, period],
      );
      return new Map(rows.map((row) => [row.business_date, row.state]));
    },

    async nextSnapshotSequence(workspaceId, employeeId, period) {
      const rows = await db.query<{ next: number }>(
        `SELECT coalesce(max(sequence), 0) + 1 AS next
           FROM monthly_closing_snapshots
          WHERE workspace_id = $1 AND employee_id = $2 AND period = $3`,
        [workspaceId, employeeId, period],
      );
      return rows[0]?.next ?? 1;
    },

    async insertSnapshot(workspaceId, input) {
      const { summary } = input;
      const rows = await db.query<SnapshotRow>(
        `INSERT INTO monthly_closing_snapshots
           (workspace_id, employee_id, period, sequence, closed_by_user_id,
            counted_days, day_versions, worked_days, leave_days,
            attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
            within_schedule_minutes, outside_schedule_minutes, night_minutes,
            non_working_day_minutes, leave_minutes, absence_minutes,
            legal_inside_overtime_minutes, legal_overtime_minutes, legal_holiday_minutes,
            non_legal_holiday_minutes, night_overtime_minutes, night_holiday_minutes,
            late_minutes, early_leave_minutes, deemed_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
         RETURNING sequence, closed_at, closed_by_user_id, period, counted_days,
                   worked_days, leave_days, ${TOTALS_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.period,
          input.sequence,
          input.closedByUserId,
          summary.countedDays,
          JSON.stringify(input.dayVersions),
          summary.workedDays,
          summary.leaveDays,
          summary.attendedMinutes,
          summary.workedMinutes,
          summary.breakMinutes,
          summary.scheduledMinutes,
          summary.withinScheduleMinutes,
          summary.outsideScheduleMinutes,
          summary.nightMinutes,
          summary.nonWorkingDayMinutes,
          summary.leaveMinutes,
          summary.absenceMinutes,
          summary.legalInsideOvertimeMinutes,
          summary.legalOvertimeMinutes,
          summary.legalHolidayMinutes,
          summary.nonLegalHolidayMinutes,
          summary.nightOvertimeMinutes,
          summary.nightHolidayMinutes,
          summary.lateMinutes,
          summary.earlyLeaveMinutes,
          summary.deemedMinutes,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('締めた集計を保存できませんでした');
      return toSnapshot({ ...row, business_date: input.period, version: 0 });
    },

    async findLatestSnapshot(workspaceId, employeeId, period) {
      const rows = await db.query<SnapshotRow>(
        `SELECT sequence, closed_at, closed_by_user_id, period, counted_days,
                worked_days, leave_days, ${TOTALS_COLUMNS}
           FROM monthly_closing_snapshots
          WHERE workspace_id = $1 AND employee_id = $2 AND period = $3
          ORDER BY sequence DESC
          LIMIT 1`,
        [workspaceId, employeeId, period],
      );
      const row = rows[0];
      return row ? toSnapshot({ ...row, business_date: period, version: 0 }) : null;
    },

    async findClosingState(workspaceId, employeeId, period) {
      const rows = await db.query<{ state: 'open' | 'closed' }>(
        `SELECT state FROM monthly_closings
          WHERE workspace_id = $1 AND employee_id = $2 AND period = $3`,
        [workspaceId, employeeId, period],
      );
      return rows[0]?.state ?? null;
    },

    async listEmployeesForPeriod(workspaceId, employeeId) {
      return db.query<{ id: string; employeeNumber: string; displayName: string }>(
        `SELECT id, employee_number AS "employeeNumber", display_name AS "displayName"
           FROM employees
          WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id = $2)
          ORDER BY employee_number`,
        [workspaceId, employeeId ?? null],
      );
    },

    async listDatesWithData(workspaceId, employeeId, from, to) {
      const rows = await db.query<{ business_date: string }>(
        `SELECT business_date::text AS business_date FROM attendance_events
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date BETWEEN $3 AND $4
         UNION
         SELECT business_date::text FROM work_schedules
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date BETWEEN $3 AND $4
         UNION
         SELECT business_date::text FROM attendance_calculations
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date BETWEEN $3 AND $4`,
        [workspaceId, employeeId, from, to],
      );
      return new Set(rows.map((row) => row.business_date));
    },

    async listClosedDates(workspaceId, employeeId, from, to) {
      const rows = await db.query<{ business_date: string }>(
        `SELECT generate_series(
                  greatest(closings.period, $3::date),
                  least((closings.period + interval '1 month' - interval '1 day')::date, $4::date),
                  interval '1 day'
                )::date::text AS business_date
           FROM monthly_closings AS closings
          WHERE closings.workspace_id = $1
            AND closings.employee_id = $2
            AND closings.state = 'closed'
            AND closings.period <= $4::date
            AND (closings.period + interval '1 month') > $3::date`,
        [workspaceId, employeeId, from, to],
      );
      return new Set(rows.map((row) => row.business_date));
    },
  };
}
