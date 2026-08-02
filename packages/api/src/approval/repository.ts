import type {
  DailyRequestRecord,
  MonthlyClosingRecord,
  RequestTransitionRecord,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type {
  BusinessDate,
  DailyRequestEventType,
  DailyRequestState,
  MonthlyClosingState,
} from '@staffweave/domain';

export interface ApprovalRepository {
  findRequest(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<DailyRequestRecord | null>;
  findRequestById(workspaceId: string, requestId: string): Promise<DailyRequestRecord | null>;
  listRequests(
    workspaceId: string,
    query: { employeeId?: string; from: string; to: string; state?: DailyRequestState },
  ): Promise<DailyRequestRecord[]>;
  saveRequest(
    workspaceId: string,
    input: {
      employeeId: string;
      businessDate: BusinessDate;
      state: DailyRequestState;
      submissions: number;
      returns: number;
      submittedAt: Date | null;
      decidedAt: Date | null;
      decidedByUserId: string | null;
    },
  ): Promise<DailyRequestRecord>;
  recordTransition(
    workspaceId: string,
    input: {
      requestId: string;
      fromState: DailyRequestState;
      toState: DailyRequestState;
      event: DailyRequestEventType;
      actorUserId: string | null;
      comment: string | null;
    },
  ): Promise<void>;

  findClosing(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<MonthlyClosingRecord | null>;
  listClosings(
    workspaceId: string,
    query: { employeeId?: string; from: string; to: string },
  ): Promise<MonthlyClosingRecord[]>;
  saveClosing(
    workspaceId: string,
    input: {
      employeeId: string;
      period: string;
      state: MonthlyClosingState;
      reopens: number;
      closedAt: Date | null;
      closedByUserId: string | null;
      reopenedAt: Date | null;
      reopenedByUserId: string | null;
      reopenReason: string | null;
    },
  ): Promise<MonthlyClosingRecord>;

  /** 締め対象の期間に、打刻があるのに承認されていない業務日がいくつあるか。 */
  countUnapprovedDays(workspaceId: string, employeeId: string, period: string): Promise<number>;

  /** 承認済みの申請を差し戻しへ戻す（締め解除時のみ）。 */
  reopenApprovedRequests(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<DailyRequestRecord[]>;
}

interface RequestRow {
  id: string;
  employee_id: string;
  business_date: string;
  state: DailyRequestState;
  submissions: number;
  returns: number;
  submitted_at: Date | null;
  decided_at: Date | null;
  decided_by_user_id: string | null;
}

interface TransitionRow {
  request_id: string;
  from_state: DailyRequestState;
  to_state: DailyRequestState;
  event: DailyRequestEventType;
  actor_user_id: string | null;
  comment: string | null;
  occurred_at: Date;
}

interface ClosingRow {
  employee_id: string;
  period: string;
  state: MonthlyClosingState;
  reopens: number;
  closed_at: Date | null;
  closed_by_user_id: string | null;
  reopened_at: Date | null;
  reopen_reason: string | null;
}

const REQUEST_COLUMNS = `id, employee_id, business_date, state, submissions, returns,
  submitted_at, decided_at, decided_by_user_id`;
const CLOSING_COLUMNS = `employee_id, period, state, reopens, closed_at, closed_by_user_id,
  reopened_at, reopen_reason`;

function toTransition(row: TransitionRow): RequestTransitionRecord {
  return {
    fromState: row.from_state,
    toState: row.to_state,
    event: row.event,
    actorUserId: row.actor_user_id,
    comment: row.comment,
    occurredAt: row.occurred_at.toISOString(),
  };
}

function toClosing(row: ClosingRow): MonthlyClosingRecord {
  return {
    employeeId: row.employee_id,
    period: row.period,
    state: row.state,
    reopens: row.reopens,
    closedAt: row.closed_at?.toISOString() ?? null,
    closedByUserId: row.closed_by_user_id,
    reopenedAt: row.reopened_at?.toISOString() ?? null,
    reopenReason: row.reopen_reason,
  };
}

export function createApprovalRepository(db: Queryable): ApprovalRepository {
  /**
   * 申請の状態遷移を、対象の申請すべてについて 1 回で読む。
   * 申請ごとに引くと、一覧の問い合わせ回数が件数に比例する。
   */
  async function transitionsOf(
    workspaceId: string,
    requestIds: readonly string[],
  ): Promise<Map<string, RequestTransitionRecord[]>> {
    const grouped = new Map<string, RequestTransitionRecord[]>();
    if (requestIds.length === 0) return grouped;

    const rows = await db.query<TransitionRow>(
      `SELECT request_id, from_state, to_state, event, actor_user_id, comment, occurred_at
         FROM attendance_request_transitions
        WHERE workspace_id = $1 AND request_id = ANY($2::uuid[])
        ORDER BY occurred_at, id`,
      [workspaceId, [...requestIds]],
    );

    // 並び順は問い合わせが決める。ここでは申請ごとに振り分けるだけで、順序を触らない。
    for (const row of rows) {
      const transitions = grouped.get(row.request_id) ?? [];
      transitions.push(toTransition(row));
      grouped.set(row.request_id, transitions);
    }
    return grouped;
  }

  function toRequest(row: RequestRow, transitions: RequestTransitionRecord[]): DailyRequestRecord {
    return {
      id: row.id,
      employeeId: row.employee_id,
      businessDate: row.business_date,
      state: row.state,
      submissions: row.submissions,
      returns: row.returns,
      submittedAt: row.submitted_at?.toISOString() ?? null,
      decidedAt: row.decided_at?.toISOString() ?? null,
      decidedByUserId: row.decided_by_user_id,
      transitions,
    };
  }

  async function toRequests(
    workspaceId: string,
    rows: readonly RequestRow[],
  ): Promise<DailyRequestRecord[]> {
    const transitions = await transitionsOf(
      workspaceId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toRequest(row, transitions.get(row.id) ?? []));
  }

  async function toSingleRequest(
    workspaceId: string,
    row: RequestRow,
  ): Promise<DailyRequestRecord> {
    const [request] = await toRequests(workspaceId, [row]);
    if (!request) throw new Error('申請を組み立てられませんでした');
    return request;
  }

  return {
    async findRequest(workspaceId, employeeId, businessDate) {
      const rows = await db.query<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM daily_attendance_requests
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3`,
        [workspaceId, employeeId, businessDate],
      );
      return rows[0] ? toSingleRequest(workspaceId, rows[0]) : null;
    },

    async findRequestById(workspaceId, requestId) {
      const rows = await db.query<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM daily_attendance_requests
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, requestId],
      );
      return rows[0] ? toSingleRequest(workspaceId, rows[0]) : null;
    },

    async listRequests(workspaceId, query) {
      const rows = await db.query<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM daily_attendance_requests
          WHERE workspace_id = $1
            AND business_date BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR employee_id = $4)
            AND ($5::text IS NULL OR state = $5)
          ORDER BY business_date, employee_id`,
        [workspaceId, query.from, query.to, query.employeeId ?? null, query.state ?? null],
      );
      return toRequests(workspaceId, rows);
    },

    async saveRequest(workspaceId, input) {
      const rows = await db.query<RequestRow>(
        `INSERT INTO daily_attendance_requests
           (workspace_id, employee_id, business_date, state, submissions, returns,
            submitted_at, decided_at, decided_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, employee_id, business_date) DO UPDATE
           SET state              = EXCLUDED.state,
               submissions        = EXCLUDED.submissions,
               returns            = EXCLUDED.returns,
               submitted_at       = EXCLUDED.submitted_at,
               decided_at         = EXCLUDED.decided_at,
               decided_by_user_id = EXCLUDED.decided_by_user_id,
               updated_at         = now()
         RETURNING ${REQUEST_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.businessDate,
          input.state,
          input.submissions,
          input.returns,
          input.submittedAt,
          input.decidedAt,
          input.decidedByUserId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('申請を保存できませんでした');
      return toSingleRequest(workspaceId, row);
    },

    async recordTransition(workspaceId, input) {
      await db.query(
        `INSERT INTO attendance_request_transitions
           (workspace_id, request_id, from_state, to_state, event, actor_user_id, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          workspaceId,
          input.requestId,
          input.fromState,
          input.toState,
          input.event,
          input.actorUserId,
          input.comment,
        ],
      );
    },

    async findClosing(workspaceId, employeeId, period) {
      const rows = await db.query<ClosingRow>(
        `SELECT ${CLOSING_COLUMNS} FROM monthly_closings
          WHERE workspace_id = $1 AND employee_id = $2 AND period = $3`,
        [workspaceId, employeeId, period],
      );
      return rows[0] ? toClosing(rows[0]) : null;
    },

    async listClosings(workspaceId, query) {
      const rows = await db.query<ClosingRow>(
        `SELECT ${CLOSING_COLUMNS} FROM monthly_closings
          WHERE workspace_id = $1
            AND period BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR employee_id = $4)
          ORDER BY period, employee_id`,
        [workspaceId, query.from, query.to, query.employeeId ?? null],
      );
      return rows.map(toClosing);
    },

    async saveClosing(workspaceId, input) {
      const rows = await db.query<ClosingRow>(
        `INSERT INTO monthly_closings
           (workspace_id, employee_id, period, state, reopens, closed_at, closed_by_user_id,
            reopened_at, reopened_by_user_id, reopen_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (workspace_id, employee_id, period) DO UPDATE
           SET state               = EXCLUDED.state,
               reopens             = EXCLUDED.reopens,
               closed_at           = EXCLUDED.closed_at,
               closed_by_user_id   = EXCLUDED.closed_by_user_id,
               reopened_at         = EXCLUDED.reopened_at,
               reopened_by_user_id = EXCLUDED.reopened_by_user_id,
               reopen_reason       = EXCLUDED.reopen_reason,
               updated_at          = now()
         RETURNING ${CLOSING_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.period,
          input.state,
          input.reopens,
          input.closedAt,
          input.closedByUserId,
          input.reopenedAt,
          input.reopenedByUserId,
          input.reopenReason,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('締めを保存できませんでした');
      return toClosing(row);
    },

    async countUnapprovedDays(workspaceId, employeeId, period) {
      const rows = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM (
             SELECT DISTINCT business_date
               FROM attendance_events
              WHERE workspace_id = $1
                AND employee_id = $2
                AND business_date >= $3::date
                AND business_date < ($3::date + interval '1 month')
           ) AS days
           LEFT JOIN daily_attendance_requests AS requests
             ON requests.workspace_id = $1
            AND requests.employee_id = $2
            AND requests.business_date = days.business_date
          WHERE requests.state IS DISTINCT FROM 'approved'`,
        [workspaceId, employeeId, period],
      );
      return rows[0]?.count ?? 0;
    },

    async reopenApprovedRequests(workspaceId, employeeId, period) {
      const rows = await db.query<RequestRow>(
        `UPDATE daily_attendance_requests
            SET state = 'returned', updated_at = now()
          WHERE workspace_id = $1
            AND employee_id = $2
            AND state = 'approved'
            AND business_date >= $3::date
            AND business_date < ($3::date + interval '1 month')
          RETURNING ${REQUEST_COLUMNS}`,
        [workspaceId, employeeId, period],
      );
      return toRequests(workspaceId, rows);
    },
  };
}
