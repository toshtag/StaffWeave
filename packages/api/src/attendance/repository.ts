import type { AttendanceEventRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { AttendanceEventType, AttendanceSource, BusinessDate } from '@staffweave/domain';

export interface AttendanceRepository {
  /**
   * 業務日の判定に使うタイムゾーン。
   * 従業員の主たる拠点があればその値、無ければワークスペースの値を使う。
   */
  findTimeZoneForEmployee(workspaceId: string, employeeId: string): Promise<string | null>;

  /**
   * 同一従業員の打刻を直列化するための行ロック。
   * 同時に届いた出勤・退勤が、互いの結果を見ないまま二重登録されるのを防ぐ。
   */
  lockEmployee(workspaceId: string, employeeId: string): Promise<boolean>;

  findEventByRequestId(
    workspaceId: string,
    employeeId: string,
    requestId: string,
  ): Promise<AttendanceEventRecord | null>;

  listEventsForDay(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<AttendanceEventRecord[]>;

  insertEvent(
    workspaceId: string,
    input: {
      employeeId: string;
      eventType: AttendanceEventType;
      occurredAt: Date;
      businessDate: BusinessDate;
      source: AttendanceSource;
      requestId: string;
      recordedByUserId: string | null;
    },
  ): Promise<AttendanceEventRecord>;
}

interface AttendanceEventRow {
  id: string;
  employee_id: string;
  event_type: AttendanceEventType;
  occurred_at: Date;
  recorded_at: Date;
  business_date: string;
  source: AttendanceSource;
}

const EVENT_COLUMNS =
  'id, employee_id, event_type, occurred_at, recorded_at, business_date, source';

function toEvent(row: AttendanceEventRow): AttendanceEventRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    businessDate: row.business_date,
    source: row.source,
  };
}

export function createAttendanceRepository(db: Queryable): AttendanceRepository {
  return {
    async findTimeZoneForEmployee(workspaceId, employeeId) {
      const rows = await db.query<{ time_zone: string }>(
        `SELECT coalesce(sites.time_zone, workspaces.time_zone) AS time_zone
           FROM employees
           JOIN workspaces ON workspaces.id = employees.workspace_id
           LEFT JOIN sites
             ON sites.id = employees.primary_site_id
            AND sites.workspace_id = employees.workspace_id
          WHERE employees.workspace_id = $1 AND employees.id = $2`,
        [workspaceId, employeeId],
      );
      return rows[0]?.time_zone ?? null;
    },

    async lockEmployee(workspaceId, employeeId) {
      const rows = await db.query<{ id: string }>(
        'SELECT id FROM employees WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [workspaceId, employeeId],
      );
      return rows.length > 0;
    },

    async findEventByRequestId(workspaceId, employeeId, requestId) {
      const rows = await db.query<AttendanceEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM attendance_events
          WHERE workspace_id = $1 AND employee_id = $2 AND request_id = $3`,
        [workspaceId, employeeId, requestId],
      );
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async listEventsForDay(workspaceId, employeeId, businessDate) {
      const rows = await db.query<AttendanceEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM attendance_events
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3
          ORDER BY occurred_at, recorded_at`,
        [workspaceId, employeeId, businessDate],
      );
      return rows.map(toEvent);
    },

    async insertEvent(workspaceId, input) {
      const rows = await db.query<AttendanceEventRow>(
        `INSERT INTO attendance_events
           (workspace_id, employee_id, event_type, occurred_at, business_date,
            source, request_id, recorded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${EVENT_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.eventType,
          input.occurredAt,
          input.businessDate,
          input.source,
          input.requestId,
          input.recordedByUserId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('打刻を記録できませんでした');
      return toEvent(row);
    },
  };
}
