import type { AttendanceEventRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type {
  AttendanceEventType,
  AttendanceSource,
  BusinessDate,
  CorrectionAction,
} from '@staffweave/domain';

export interface InsertAttendanceEventInput {
  employeeId: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
  businessDate: BusinessDate;
  source: AttendanceSource;
  requestId: string;
  recordedByUserId: string | null;
  correctsEventId?: string | null;
  correctionAction?: CorrectionAction | null;
  correctionReason?: string | null;
}

export interface AttendanceRepository {
  /**
   * 業務日の判定に使うタイムゾーン。
   * 従業員の主たる拠点があればその値、無ければワークスペースの値を使う。
   */
  findTimeZoneForEmployee(workspaceId: string, employeeId: string): Promise<string | null>;

  /** 従業員番号から従業員を引く。端末は番号で従業員を指す。 */
  findEmployeeByNumber(
    workspaceId: string,
    employeeNumber: string,
  ): Promise<{ id: string; displayName: string } | null>;

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

  findEventById(
    workspaceId: string,
    employeeId: string,
    eventId: string,
  ): Promise<AttendanceEventRecord | null>;

  /**
   * 打刻を記録した従業員。
   * 受領記録から応答を再現するときのように、従業員が分からないまま打刻を辿る経路で使う。
   */
  findEmployeeByEventId(
    workspaceId: string,
    eventId: string,
  ): Promise<{ id: string; displayName: string } | null>;

  /** 指定した業務日に記録されたすべてのイベント（修正を含む）を追記順に返す。 */
  listEventsForDay(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<AttendanceEventRecord[]>;

  insertEvent(
    workspaceId: string,
    input: InsertAttendanceEventInput,
  ): Promise<AttendanceEventRecord>;

  /** その従業員の組織が、打刻時の位置情報を取ると決めているか。既定は取らない。 */
  capturesLocation(workspaceId: string, employeeId: string): Promise<boolean>;

  /**
   * 打刻へ位置情報を添える。
   *
   * 打刻そのものとは別の行として持つ。同じ行に持つと、位置情報を消すために
   * 打刻の行へ触れることになり、追記のみという取り決めと衝突する。
   */
  attachLocation(workspaceId: string, input: AttendanceLocationInput): Promise<void>;

  /** 期間の位置情報。閲覧の権限は呼ぶ側が確かめる。 */
  listLocations(
    workspaceId: string,
    employeeId: string,
    range: { from: BusinessDate; to: BusinessDate },
  ): Promise<AttendanceLocationRecordRow[]>;
}

export interface AttendanceLocationInput {
  eventId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: Date;
}

export interface AttendanceLocationRecordRow {
  eventId: string;
  businessDate: string;
  eventType: AttendanceEventType;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}

interface AttendanceEventRow {
  id: string;
  employee_id: string;
  event_type: AttendanceEventType;
  occurred_at: Date;
  recorded_at: Date;
  business_date: string;
  source: AttendanceSource;
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
    correctionAction: row.correction_action,
    correctsEventId: row.corrects_event_id,
    correctionReason: row.correction_reason,
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

    async findEmployeeByNumber(workspaceId, employeeNumber) {
      const rows = await db.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM employees
          WHERE workspace_id = $1 AND employee_number = $2 AND status = 'active'
          LIMIT 1`,
        [workspaceId, employeeNumber],
      );
      const row = rows[0];
      return row ? { id: row.id, displayName: row.display_name } : null;
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

    async findEventById(workspaceId, employeeId, eventId) {
      const rows = await db.query<AttendanceEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM attendance_events
          WHERE workspace_id = $1 AND employee_id = $2 AND id = $3`,
        [workspaceId, employeeId, eventId],
      );
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async findEmployeeByEventId(workspaceId, eventId) {
      const rows = await db.query<{ id: string; display_name: string }>(
        `SELECT employees.id, employees.display_name
           FROM attendance_events
           JOIN employees
             ON employees.id = attendance_events.employee_id
            AND employees.workspace_id = attendance_events.workspace_id
          WHERE attendance_events.workspace_id = $1 AND attendance_events.id = $2`,
        [workspaceId, eventId],
      );
      const row = rows[0];
      return row ? { id: row.id, displayName: row.display_name } : null;
    },

    async listEventsForDay(workspaceId, employeeId, businessDate) {
      const rows = await db.query<AttendanceEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM attendance_events
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3
          ORDER BY recorded_at, id`,
        [workspaceId, employeeId, businessDate],
      );
      return rows.map(toEvent);
    },

    async insertEvent(workspaceId, input) {
      const rows = await db.query<AttendanceEventRow>(
        `INSERT INTO attendance_events
           (workspace_id, employee_id, event_type, occurred_at, business_date,
            source, request_id, recorded_by_user_id,
            corrects_event_id, correction_action, correction_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
          input.correctsEventId ?? null,
          input.correctionAction ?? null,
          input.correctionReason ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('打刻を記録できませんでした');
      return toEvent(row);
    },

    async capturesLocation(workspaceId, employeeId) {
      const rows = await db.query<{ location_capture: boolean }>(
        `SELECT organizations.location_capture
           FROM employees
           JOIN organizations
             ON organizations.id = employees.organization_id
            AND organizations.workspace_id = employees.workspace_id
          WHERE employees.workspace_id = $1 AND employees.id = $2`,
        [workspaceId, employeeId],
      );
      return rows[0]?.location_capture ?? false;
    },

    async attachLocation(workspaceId, input) {
      await db.query(
        `INSERT INTO attendance_event_locations
           (event_id, workspace_id, latitude, longitude, accuracy_meters, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          input.eventId,
          workspaceId,
          input.latitude,
          input.longitude,
          input.accuracyMeters,
          input.capturedAt,
        ],
      );
    },

    async listLocations(workspaceId, employeeId, range) {
      const rows = await db.query<{
        event_id: string;
        business_date: string;
        event_type: AttendanceEventType;
        latitude: string;
        longitude: string;
        accuracy_meters: number;
        captured_at: Date;
      }>(
        `SELECT locations.event_id, events.business_date, events.event_type,
                locations.latitude, locations.longitude, locations.accuracy_meters,
                locations.captured_at
           FROM attendance_event_locations AS locations
           JOIN attendance_events AS events
             ON events.id = locations.event_id AND events.workspace_id = locations.workspace_id
          WHERE locations.workspace_id = $1 AND events.employee_id = $2
            AND events.business_date BETWEEN $3::date AND $4::date
          ORDER BY events.business_date, locations.captured_at`,
        [workspaceId, employeeId, range.from, range.to],
      );
      return rows.map((row) => ({
        eventId: row.event_id,
        businessDate: row.business_date,
        eventType: row.event_type,
        // numeric は文字列で返る。数として扱う前に、ここで一度だけ直す。
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracyMeters: row.accuracy_meters,
        capturedAt: row.captured_at.toISOString(),
      }));
    },
  };
}
