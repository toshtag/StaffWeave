import type { Queryable } from '@staffweave/db';
import type { AttendanceEventType } from '@staffweave/domain';

/**
 * 異常検出のための事実収集。
 *
 * 判定そのものはドメイン層で行い、ここでは「何が起きていたか」を集めるだけにする。
 * すべてワークスペースで絞り、必要なら従業員でも絞る。
 */

export interface PostFinalizationChange {
  employeeId: string;
  businessDate: string;
  eventId: string;
  recordedAt: string;
  decidedAt: string;
  requestState: string;
}

export interface CorrectionCount {
  employeeId: string;
  businessDate: string;
  corrections: number;
}

export interface DeviceReceiptFact {
  deviceId: string;
  deviceName: string;
  sequence: number;
  receivedAt: string;
  clockSkewSeconds: number;
  sequenceStep: number;
  outcome: string;
  reason: string | null;
}

export interface DayEventFact {
  employeeId: string;
  businessDate: string;
  eventId: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
}

export interface AnomalyQuery {
  from: string;
  to: string;
  employeeId?: string;
}

export interface AnomalyRepository {
  listPostFinalizationChanges(
    workspaceId: string,
    query: AnomalyQuery,
  ): Promise<PostFinalizationChange[]>;
  listCorrectionCounts(workspaceId: string, query: AnomalyQuery): Promise<CorrectionCount[]>;
  listDeviceReceipts(workspaceId: string, query: AnomalyQuery): Promise<DeviceReceiptFact[]>;
  listEffectiveEvents(workspaceId: string, query: AnomalyQuery): Promise<DayEventFact[]>;
}

export function createAnomalyRepository(db: Queryable): AnomalyRepository {
  return {
    async listPostFinalizationChanges(workspaceId, query) {
      const rows = await db.query<{
        employee_id: string;
        business_date: string;
        event_id: string;
        recorded_at: Date;
        decided_at: Date;
        state: string;
      }>(
        `SELECT events.employee_id,
                events.business_date,
                events.id AS event_id,
                events.recorded_at,
                requests.decided_at,
                requests.state
           FROM attendance_events AS events
           JOIN daily_attendance_requests AS requests
             ON requests.workspace_id = events.workspace_id
            AND requests.employee_id = events.employee_id
            AND requests.business_date = events.business_date
          WHERE events.workspace_id = $1
            AND events.business_date BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR events.employee_id = $4)
            AND requests.state = 'approved'
            AND requests.decided_at IS NOT NULL
            AND events.recorded_at > requests.decided_at
          ORDER BY events.recorded_at`,
        [workspaceId, query.from, query.to, query.employeeId ?? null],
      );

      return rows.map((row) => ({
        employeeId: row.employee_id,
        businessDate: row.business_date,
        eventId: row.event_id,
        recordedAt: row.recorded_at.toISOString(),
        decidedAt: row.decided_at.toISOString(),
        requestState: row.state,
      }));
    },

    async listCorrectionCounts(workspaceId, query) {
      const rows = await db.query<{
        employee_id: string;
        business_date: string;
        corrections: number;
      }>(
        `SELECT employee_id, business_date, count(*)::int AS corrections
           FROM attendance_events
          WHERE workspace_id = $1
            AND business_date BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR employee_id = $4)
            AND source = 'correction'
          GROUP BY employee_id, business_date
          ORDER BY business_date`,
        [workspaceId, query.from, query.to, query.employeeId ?? null],
      );

      return rows.map((row) => ({
        employeeId: row.employee_id,
        businessDate: row.business_date,
        corrections: row.corrections,
      }));
    },

    async listDeviceReceipts(workspaceId, query) {
      const rows = await db.query<{
        device_id: string;
        device_name: string;
        sequence: number;
        received_at: Date;
        clock_skew_seconds: number;
        sequence_step: number;
        outcome: string;
        reason: string | null;
      }>(
        `SELECT receipts.device_id,
                devices.name AS device_name,
                receipts.sequence,
                receipts.received_at,
                receipts.clock_skew_seconds,
                receipts.sequence_step,
                receipts.outcome,
                receipts.detail ->> 'reason' AS reason
           FROM device_event_receipts AS receipts
           JOIN devices
             ON devices.id = receipts.device_id
            AND devices.workspace_id = receipts.workspace_id
          WHERE receipts.workspace_id = $1
            AND receipts.received_at >= $2::date
            AND receipts.received_at < ($3::date + interval '1 day')
          ORDER BY receipts.received_at`,
        [workspaceId, query.from, query.to],
      );

      return rows.map((row) => ({
        deviceId: row.device_id,
        deviceName: row.device_name,
        sequence: row.sequence,
        receivedAt: row.received_at.toISOString(),
        clockSkewSeconds: row.clock_skew_seconds,
        sequenceStep: row.sequence_step,
        outcome: row.outcome,
        reason: row.reason,
      }));
    },

    async listEffectiveEvents(workspaceId, query) {
      // 取り消された打刻と、修正で置き換えられた元の打刻は除く。
      const rows = await db.query<{
        employee_id: string;
        business_date: string;
        id: string;
        event_type: AttendanceEventType;
        occurred_at: Date;
      }>(
        `SELECT events.employee_id, events.business_date, events.id, events.event_type,
                events.occurred_at
           FROM attendance_events AS events
          WHERE events.workspace_id = $1
            AND events.business_date BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR events.employee_id = $4)
            AND (events.correction_action IS NULL OR events.correction_action <> 'void')
            AND NOT EXISTS (
              SELECT 1 FROM attendance_events AS corrections
               WHERE corrections.workspace_id = events.workspace_id
                 AND corrections.corrects_event_id = events.id
            )
          ORDER BY events.employee_id, events.business_date, events.occurred_at`,
        [workspaceId, query.from, query.to, query.employeeId ?? null],
      );

      return rows.map((row) => ({
        employeeId: row.employee_id,
        businessDate: row.business_date,
        eventId: row.id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
      }));
    },
  };
}
