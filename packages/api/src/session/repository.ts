import type { SessionObservationRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { BusinessDate, SessionObservationType } from '@staffweave/domain';

export interface SessionObservationRepository {
  /** 同じ冪等キーで記録済みかどうか。まとめ送りの再送を判定する。 */
  countByRequestId(workspaceId: string, requestId: string): Promise<number>;
  insert(
    workspaceId: string,
    input: {
      employeeId: string;
      deviceId: string | null;
      observationType: SessionObservationType;
      occurredAt: Date;
      businessDate: BusinessDate;
      requestId: string;
      workstationName: string | null;
    },
  ): Promise<SessionObservationRecord>;
  listForDay(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<SessionObservationRecord[]>;
  listForRange(
    workspaceId: string,
    query: { employeeId?: string; from: string; to: string },
  ): Promise<SessionObservationRecord[]>;
}

interface ObservationRow {
  id: string;
  employee_id: string;
  observation_type: SessionObservationType;
  occurred_at: Date;
  recorded_at: Date;
  business_date: string;
  workstation_name: string | null;
}

const COLUMNS = `id, employee_id, observation_type, occurred_at, recorded_at,
  business_date, workstation_name`;

function toObservation(row: ObservationRow): SessionObservationRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    observationType: row.observation_type,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    businessDate: row.business_date,
    workstationName: row.workstation_name,
  };
}

export function createSessionObservationRepository(db: Queryable): SessionObservationRepository {
  return {
    async countByRequestId(workspaceId, requestId) {
      const rows = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM workstation_session_observations
          WHERE workspace_id = $1 AND request_id = $2`,
        [workspaceId, requestId],
      );
      return rows[0]?.count ?? 0;
    },

    async insert(workspaceId, input) {
      const rows = await db.query<ObservationRow>(
        `INSERT INTO workstation_session_observations
           (workspace_id, employee_id, device_id, observation_type, occurred_at,
            business_date, request_id, workstation_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.deviceId,
          input.observationType,
          input.occurredAt,
          input.businessDate,
          input.requestId,
          input.workstationName,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('観測を記録できませんでした');
      return toObservation(row);
    },

    async listForDay(workspaceId, employeeId, businessDate) {
      const rows = await db.query<ObservationRow>(
        `SELECT ${COLUMNS} FROM workstation_session_observations
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3
          ORDER BY occurred_at`,
        [workspaceId, employeeId, businessDate],
      );
      return rows.map(toObservation);
    },

    async listForRange(workspaceId, query) {
      const rows = await db.query<ObservationRow>(
        `SELECT ${COLUMNS} FROM workstation_session_observations
          WHERE workspace_id = $1
            AND business_date BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR employee_id = $4)
          ORDER BY business_date, occurred_at`,
        [workspaceId, query.from, query.to, query.employeeId ?? null],
      );
      return rows.map(toObservation);
    },
  };
}
