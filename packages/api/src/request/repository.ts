import type {
  CreateRequestTypeRequest,
  EmployeeRequestRecord,
  RequestApprovalRecord,
  RequestTypeRecord,
  UpdateRequestTypeRequest,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { ApprovedAdjustments } from '@staffweave/domain';

/**
 * 申請種別と申請の読み書き。
 *
 * 申請は、提出時に写した段数を自分で持つ。
 * 種別の定義を都度参照すると、承認の途中で段数を変えられたときに経路が変わる。
 */
export interface RequestRepository {
  listRequestTypes(workspaceId: string): Promise<RequestTypeRecord[]>;
  findRequestType(workspaceId: string, requestTypeId: string): Promise<RequestTypeRecord | null>;
  createRequestType(
    workspaceId: string,
    input: CreateRequestTypeRequest,
  ): Promise<RequestTypeRecord>;
  updateRequestType(
    workspaceId: string,
    requestTypeId: string,
    input: UpdateRequestTypeRequest,
  ): Promise<RequestTypeRecord | null>;

  listRequests(workspaceId: string, query: ListRequestsQuery): Promise<EmployeeRequestRecord[]>;
  findRequest(workspaceId: string, requestId: string): Promise<EmployeeRequestRecord | null>;
  insertRequest(workspaceId: string, input: NewEmployeeRequest): Promise<EmployeeRequestRecord>;
  updateRequestState(
    workspaceId: string,
    requestId: string,
    input: RequestStateChange,
  ): Promise<EmployeeRequestRecord | null>;
  updateRequestContent(
    workspaceId: string,
    requestId: string,
    input: RequestContentChange,
  ): Promise<void>;
  addApproval(workspaceId: string, input: NewRequestApproval): Promise<RequestApprovalRecord>;

  /**
   * その業務日に効いている、承認しきった申請の内容。
   *
   * 見るのは `approved` の申請だけ。提出しただけ・差し戻し・取消は含めない。
   * 途中の段の申請まで見ると、承認する前に計算が変わってしまう。
   *
   * 期間の申請（`ends_on` を持つもの）は、期間に含まれる日すべてに効く。
   */
  findApprovedAdjustments(
    workspaceId: string,
    employeeId: string,
    businessDate: string,
  ): Promise<ApprovedAdjustments>;

  /**
   * 承認しきった申請が効いている業務日を、期間の中から拾う。
   * 決裁のあとに、どの日を計算し直すかを決めるために使う。
   */
  listAffectedDates(workspaceId: string, requestId: string): Promise<string[]>;
}

export interface ListRequestsQuery {
  employeeId?: string;
  state?: EmployeeRequestRecord['state'];
  from?: string;
  to?: string;
}

export interface NewEmployeeRequest {
  requestTypeId: string;
  employeeId: string;
  /** 提出時の定義から写した段数。 */
  totalSteps: number;
  businessDate: string;
  endsOn?: string | null;
  leaveTypeId?: string | null;
  startMinutes?: number | null;
  endMinutes?: number | null;
  overtimeLimitMinutes?: number | null;
  reason?: string | null;
}

export interface RequestStateChange {
  state: EmployeeRequestRecord['state'];
  currentStep: number;
  submissions: number;
  decidedAt: Date | null;
  submittedAt?: Date;
}

export interface RequestContentChange {
  endsOn?: string | null;
  leaveTypeId?: string | null;
  startMinutes?: number | null;
  endMinutes?: number | null;
  overtimeLimitMinutes?: number | null;
  reason?: string | null;
}

export interface NewRequestApproval {
  requestId: string;
  step: number;
  submission: number;
  decision: RequestApprovalRecord['decision'];
  decidedByUserId?: string | null;
  onBehalfOfUserId?: string | null;
  comment?: string | null;
}

interface TypeRow {
  id: string;
  code: string;
  name: string;
  category: RequestTypeRecord['category'];
  approval_steps: number;
  requires_reason: boolean;
  requires_leave_type: boolean;
  requires_time_range: boolean;
  requires_overtime_limit: boolean;
  active: boolean;
  created_at: Date;
}

const TYPE_COLUMNS = `id, code, name, category, approval_steps, requires_reason,
  requires_leave_type, requires_time_range, requires_overtime_limit, active, created_at`;

function toRequestType(row: TypeRow): RequestTypeRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    approvalSteps: row.approval_steps,
    requiresReason: row.requires_reason,
    requiresLeaveType: row.requires_leave_type,
    requiresTimeRange: row.requires_time_range,
    requiresOvertimeLimit: row.requires_overtime_limit,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

interface RequestRow {
  id: string;
  request_type_id: string;
  employee_id: string;
  state: EmployeeRequestRecord['state'];
  total_steps: number;
  current_step: number;
  submissions: number;
  business_date: string;
  ends_on: string | null;
  leave_type_id: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  overtime_limit_minutes: number | null;
  reason: string | null;
  submitted_at: Date;
  decided_at: Date | null;
}

const REQUEST_COLUMNS = `id, request_type_id, employee_id, state, total_steps, current_step,
  submissions, business_date, ends_on, leave_type_id, start_minutes, end_minutes,
  overtime_limit_minutes, reason, submitted_at, decided_at`;

function toRequest(row: RequestRow, approvals: RequestApprovalRecord[]): EmployeeRequestRecord {
  return {
    id: row.id,
    requestTypeId: row.request_type_id,
    employeeId: row.employee_id,
    state: row.state,
    totalSteps: row.total_steps,
    currentStep: row.current_step,
    submissions: row.submissions,
    businessDate: row.business_date,
    endsOn: row.ends_on,
    leaveTypeId: row.leave_type_id,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    overtimeLimitMinutes: row.overtime_limit_minutes,
    reason: row.reason,
    submittedAt: row.submitted_at.toISOString(),
    decidedAt: row.decided_at === null ? null : row.decided_at.toISOString(),
    approvals,
  };
}

interface ApprovalRow {
  id: string;
  request_id: string;
  step: number;
  submission: number;
  decision: RequestApprovalRecord['decision'];
  decided_by_user_id: string | null;
  on_behalf_of_user_id: string | null;
  comment: string | null;
  decided_at: Date;
}

const APPROVAL_COLUMNS = `id, request_id, step, submission, decision, decided_by_user_id,
  on_behalf_of_user_id, comment, decided_at`;

function toApproval(row: ApprovalRow): RequestApprovalRecord {
  return {
    id: row.id,
    step: row.step,
    submission: row.submission,
    decision: row.decision,
    decidedByUserId: row.decided_by_user_id,
    onBehalfOfUserId: row.on_behalf_of_user_id,
    comment: row.comment,
    decidedAt: row.decided_at.toISOString(),
  };
}

export function createRequestRepository(db: Queryable): RequestRepository {
  /** 申請ごとの決裁をまとめて引く。件数ぶんの問い合わせにしない。 */
  async function approvalsOf(
    workspaceId: string,
    requestIds: readonly string[],
  ): Promise<Map<string, RequestApprovalRecord[]>> {
    const byRequest = new Map<string, RequestApprovalRecord[]>();
    if (requestIds.length === 0) return byRequest;

    const rows = await db.query<ApprovalRow>(
      `SELECT ${APPROVAL_COLUMNS} FROM employee_request_approvals
        WHERE workspace_id = $1 AND request_id = ANY($2::uuid[])
        ORDER BY submission, step, decided_at`,
      [workspaceId, requestIds as string[]],
    );
    for (const row of rows) {
      const list = byRequest.get(row.request_id) ?? [];
      list.push(toApproval(row));
      byRequest.set(row.request_id, list);
    }
    return byRequest;
  }

  async function loadRequest(
    workspaceId: string,
    requestId: string,
  ): Promise<EmployeeRequestRecord | null> {
    const rows = await db.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM employee_requests WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, requestId],
    );
    const row = rows[0];
    if (!row) return null;
    const approvals = await approvalsOf(workspaceId, [row.id]);
    return toRequest(row, approvals.get(row.id) ?? []);
  }

  return {
    async listRequestTypes(workspaceId) {
      const rows = await db.query<TypeRow>(
        `SELECT ${TYPE_COLUMNS} FROM request_types WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toRequestType);
    },

    async findRequestType(workspaceId, requestTypeId) {
      const rows = await db.query<TypeRow>(
        `SELECT ${TYPE_COLUMNS} FROM request_types WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, requestTypeId],
      );
      const row = rows[0];
      return row ? toRequestType(row) : null;
    },

    async createRequestType(workspaceId, input) {
      const rows = await db.query<TypeRow>(
        `INSERT INTO request_types
           (workspace_id, code, name, category, approval_steps, requires_reason,
            requires_leave_type, requires_time_range, requires_overtime_limit)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), COALESCE($7, false),
                 COALESCE($8, false), COALESCE($9, false))
         RETURNING ${TYPE_COLUMNS}`,
        [
          workspaceId,
          input.code,
          input.name,
          input.category,
          input.approvalSteps,
          input.requiresReason ?? null,
          input.requiresLeaveType ?? null,
          input.requiresTimeRange ?? null,
          input.requiresOvertimeLimit ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('申請種別を作れませんでした');
      return toRequestType(row);
    },

    async updateRequestType(workspaceId, requestTypeId, input) {
      const rows = await db.query<TypeRow>(
        `UPDATE request_types
            SET name = COALESCE($3, name),
                approval_steps = COALESCE($4, approval_steps),
                requires_reason = COALESCE($5, requires_reason),
                requires_leave_type = COALESCE($6, requires_leave_type),
                requires_time_range = COALESCE($7, requires_time_range),
                requires_overtime_limit = COALESCE($8, requires_overtime_limit),
                active = COALESCE($9, active)
          WHERE workspace_id = $1 AND id = $2
        RETURNING ${TYPE_COLUMNS}`,
        [
          workspaceId,
          requestTypeId,
          input.name ?? null,
          input.approvalSteps ?? null,
          input.requiresReason ?? null,
          input.requiresLeaveType ?? null,
          input.requiresTimeRange ?? null,
          input.requiresOvertimeLimit ?? null,
          input.active ?? null,
        ],
      );
      const row = rows[0];
      return row ? toRequestType(row) : null;
    },

    async listRequests(workspaceId, query) {
      const rows = await db.query<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM employee_requests
          WHERE workspace_id = $1
            AND ($2::uuid IS NULL OR employee_id = $2)
            AND ($3::text IS NULL OR state = $3)
            AND ($4::date IS NULL OR business_date >= $4)
            AND ($5::date IS NULL OR business_date <= $5)
          ORDER BY business_date DESC, submitted_at DESC`,
        [
          workspaceId,
          query.employeeId ?? null,
          query.state ?? null,
          query.from ?? null,
          query.to ?? null,
        ],
      );
      const approvals = await approvalsOf(
        workspaceId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toRequest(row, approvals.get(row.id) ?? []));
    },

    findRequest: loadRequest,

    async insertRequest(workspaceId, input) {
      const rows = await db.query<RequestRow>(
        `INSERT INTO employee_requests
           (workspace_id, request_type_id, employee_id, total_steps, business_date, ends_on,
            leave_type_id, start_minutes, end_minutes, overtime_limit_minutes, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${REQUEST_COLUMNS}`,
        [
          workspaceId,
          input.requestTypeId,
          input.employeeId,
          input.totalSteps,
          input.businessDate,
          input.endsOn ?? null,
          input.leaveTypeId ?? null,
          input.startMinutes ?? null,
          input.endMinutes ?? null,
          input.overtimeLimitMinutes ?? null,
          input.reason ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('申請を保存できませんでした');
      return toRequest(row, []);
    },

    async updateRequestState(workspaceId, requestId, input) {
      const rows = await db.query<{ id: string }>(
        `UPDATE employee_requests
            SET state = $3,
                current_step = $4,
                submissions = $5,
                decided_at = $6,
                submitted_at = COALESCE($7, submitted_at),
                updated_at = now()
          WHERE workspace_id = $1 AND id = $2
        RETURNING id`,
        [
          workspaceId,
          requestId,
          input.state,
          input.currentStep,
          input.submissions,
          input.decidedAt,
          input.submittedAt ?? null,
        ],
      );
      return rows[0] ? loadRequest(workspaceId, requestId) : null;
    },

    async updateRequestContent(workspaceId, requestId, input) {
      await db.query(
        `UPDATE employee_requests
            SET ends_on = CASE WHEN $3::boolean THEN $4 ELSE ends_on END,
                leave_type_id = CASE WHEN $5::boolean THEN $6 ELSE leave_type_id END,
                start_minutes = CASE WHEN $7::boolean THEN $8 ELSE start_minutes END,
                end_minutes = CASE WHEN $9::boolean THEN $10 ELSE end_minutes END,
                overtime_limit_minutes =
                  CASE WHEN $11::boolean THEN $12 ELSE overtime_limit_minutes END,
                reason = CASE WHEN $13::boolean THEN $14 ELSE reason END,
                updated_at = now()
          WHERE workspace_id = $1 AND id = $2`,
        [
          workspaceId,
          requestId,
          'endsOn' in input,
          input.endsOn ?? null,
          'leaveTypeId' in input,
          input.leaveTypeId ?? null,
          'startMinutes' in input,
          input.startMinutes ?? null,
          'endMinutes' in input,
          input.endMinutes ?? null,
          'overtimeLimitMinutes' in input,
          input.overtimeLimitMinutes ?? null,
          'reason' in input,
          input.reason ?? null,
        ],
      );
    },

    async addApproval(workspaceId, input) {
      const rows = await db.query<ApprovalRow>(
        `INSERT INTO employee_request_approvals
           (workspace_id, request_id, step, submission, decision,
            decided_by_user_id, on_behalf_of_user_id, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${APPROVAL_COLUMNS}`,
        [
          workspaceId,
          input.requestId,
          input.step,
          input.submission,
          input.decision,
          input.decidedByUserId ?? null,
          input.onBehalfOfUserId ?? null,
          input.comment ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('決裁を記録できませんでした');
      return toApproval(row);
    },

    async findApprovedAdjustments(workspaceId, employeeId, businessDate) {
      // 種別は申請へ写していないため、ここで結合して読む。
      // 写すと、種別の分類を直したときに過去の申請だけが古い分類のまま残る。
      const rows = await db.query<{
        category: RequestTypeRecord['category'];
        overtime_limit_minutes: number | null;
      }>(
        `SELECT t.category, r.overtime_limit_minutes
           FROM employee_requests r
           JOIN request_types t
             ON t.id = r.request_type_id AND t.workspace_id = r.workspace_id
          WHERE r.workspace_id = $1
            AND r.employee_id = $2
            AND r.state = 'approved'
            AND r.business_date <= $3
            AND COALESCE(r.ends_on, r.business_date) >= $3`,
        [workspaceId, employeeId, businessDate],
      );

      let overtimeLimitMinutes: number | null = null;
      let holidayWorkApproved = false;
      for (const row of rows) {
        if (row.category === 'overtime' && row.overtime_limit_minutes !== null) {
          // 複数あればいちばん遅い時刻を採る。狭いほうを採ると、
          // あとから足した承認が前の承認を取り消したことになる。
          overtimeLimitMinutes = Math.max(overtimeLimitMinutes ?? 0, row.overtime_limit_minutes);
        }
        if (row.category === 'holiday_work') holidayWorkApproved = true;
      }
      return { overtimeLimitMinutes, holidayWorkApproved };
    },

    async listAffectedDates(workspaceId, requestId) {
      const rows = await db.query<{ business_date: string }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS business_date
           FROM employee_requests r,
                generate_series(r.business_date, COALESCE(r.ends_on, r.business_date), '1 day')
                  AS day
          WHERE r.workspace_id = $1 AND r.id = $2
          ORDER BY day`,
        [workspaceId, requestId],
      );
      return rows.map((row) => row.business_date);
    },
  };
}
