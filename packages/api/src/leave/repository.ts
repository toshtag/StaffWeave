import type {
  LeaveGrantRunRecord,
  LeaveLedgerEntryRecord,
  LeaveTypeSettingsRecord,
  UpdateLeaveTypeRequest,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';

/**
 * 休暇台帳の読み書き。
 *
 * 残数は保存しない。記録を積むだけで、残数はドメインが台帳から組み立てる。
 * ここに合計を持たせると、合計と記録が食い違ったときに、
 * どちらが正しいのかを決められなくなる。
 */
export interface LeaveRepository {
  listLeaveTypes(workspaceId: string): Promise<LeaveTypeSettingsRecord[]>;
  findLeaveType(workspaceId: string, leaveTypeId: string): Promise<LeaveTypeSettingsRecord | null>;
  updateLeaveType(
    workspaceId: string,
    leaveTypeId: string,
    input: UpdateLeaveTypeRequest,
  ): Promise<LeaveTypeSettingsRecord | null>;

  /**
   * その従業員の台帳を、いまのトランザクションが終わるまで他へ触らせない。
   *
   * 残数は台帳から組み立てる。読んでから積むまでの間に別の要求が積むと、
   * どちらも「足りている」と判断して、合計が負になる。
   * 一意制約は同じ申請の二度目しか止められないため、ここは順番を作る。
   */
  lockLedgerOf(workspaceId: string, employeeId: string): Promise<void>;
  listEntries(
    workspaceId: string,
    query: { employeeId: string; leaveTypeId?: string },
  ): Promise<LeaveLedgerEntryRecord[]>;
  findEntry(workspaceId: string, entryId: string): Promise<LeaveLedgerEntryRecord | null>;
  addEntry(workspaceId: string, input: NewLeaveLedgerEntry): Promise<LeaveLedgerEntryRecord>;

  /**
   * 複数の従業員の台帳をまとめて読む。
   *
   * 管理簿と失効予定は人数ぶんの残数を組み立てる。1 人ずつ読むと、
   * 人数ぶんの問い合わせが並ぶ。
   */
  listEntriesForEmployees(
    workspaceId: string,
    employeeIds: readonly string[],
    leaveTypeId?: string,
  ): Promise<Map<string, LeaveLedgerEntryRecord[]>>;

  /**
   * 自動付与を動かす休暇種別。
   *
   * 基準を置いただけでは動かさない。有効にしたものだけを返す。
   * 使えない休暇種別も返さない。止めた種別へ付与が続くと、
   * 止めたつもりの設定が残数を増やし続ける。
   */
  listAutoGrantLeaveTypes(workspaceId: string): Promise<LeaveTypeSettingsRecord[]>;

  /** 自動付与を最後に処理した日。一度も処理していなければ null。 */
  findLastGrantRun(workspaceId: string, leaveTypeId: string): Promise<string | null>;

  /**
   * 自動付与を処理した日を記録する。
   *
   * 付与が 0 件でも記録する。残さないと、対象が誰も居なかった日を
   * 毎回やり直すことになり、追いつきが進まない。
   */
  recordGrantRun(
    workspaceId: string,
    input: {
      leaveTypeId: string;
      effectiveOn: string;
      grantedCount: number;
      skippedCount: number;
    },
  ): Promise<void>;

  /** 直近の実行の記録。管理の画面が「いつ、何件」を出すために読む。 */
  listGrantRuns(
    workspaceId: string,
    leaveTypeId: string,
    limit: number,
  ): Promise<LeaveGrantRunRecord[]>;

  /** 付与規則。休暇種別を指定すると、その種別だけ。 */
  listGrantRules(workspaceId: string, leaveTypeId?: string): Promise<LeaveGrantRuleRecord[]>;
  createGrantRule(
    workspaceId: string,
    input: { leaveTypeId: string; serviceMonths: number; minutes: number },
  ): Promise<LeaveGrantRuleRecord>;

  /**
   * 一括付与の対象になりうる従業員。
   *
   * 在籍中の従業員だけを返す。退職者へ付与しても、使われないまま残数だけが増える。
   */
  listGrantCandidates(
    workspaceId: string,
    filter: { organizationId?: string },
  ): Promise<{ id: string; employeeNumber: string; hiredOn: string | null }[]>;

  /**
   * その日にすでに自動・取込で付与されている従業員。
   *
   * 積む前に読む。制約の違反を捕まえて続けることはできない。
   * PostgreSQL では、違反した時点でトランザクション全体が中断する。
   */
  listBulkGrantedEmployees(
    workspaceId: string,
    leaveTypeId: string,
    effectiveOn: string,
  ): Promise<Set<string>>;

  /** 従業員番号から識別子を引く。CSV の取込で使う。 */
  findEmployeeIdsByNumber(
    workspaceId: string,
    numbers: readonly string[],
  ): Promise<Map<string, string>>;
}

/** 勤続の段ごとの付与分数。 */
export interface LeaveGrantRuleRecord {
  id: string;
  leaveTypeId: string;
  serviceMonths: number;
  minutes: number;
  createdAt: string;
}

export interface NewLeaveLedgerEntry {
  employeeId: string;
  leaveTypeId: string;
  entryType: LeaveLedgerEntryRecord['entryType'];
  minutes: number;
  effectiveOn: string;
  expiresOn?: string | null;
  reversesEntryId?: string | null;
  requestId?: string | null;
  reason?: string | null;
  createdByUserId?: string | null;
  /** どこから来た記録か。二重付与を止める制約は、自動と取込にだけ当てる。 */
  source?: 'manual' | 'rule' | 'import' | 'request';
}

interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  unit_minutes: number | null;
  day_minutes: number | null;
  expires_after_months: number | null;
  grant_basis: LeaveTypeSettingsRecord['grantBasis'];
  auto_grant_enabled: boolean;
  auto_grant_from: string | null;
  grant_fixed_month: number | null;
  grant_fixed_day: number | null;
  active: boolean;
  created_at: Date;
}

const LEAVE_TYPE_COLUMNS = `id, code, name, paid, unit_minutes, day_minutes, expires_after_months,
   grant_basis, auto_grant_enabled, auto_grant_from, grant_fixed_month, grant_fixed_day,
   active, created_at`;

function toLeaveType(row: LeaveTypeRow): LeaveTypeSettingsRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    paid: row.paid,
    unitMinutes: row.unit_minutes,
    dayMinutes: row.day_minutes,
    expiresAfterMonths: row.expires_after_months,
    grantBasis: row.grant_basis,
    autoGrantEnabled: row.auto_grant_enabled,
    autoGrantFrom: row.auto_grant_from,
    grantFixedMonth: row.grant_fixed_month,
    grantFixedDay: row.grant_fixed_day,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

interface EntryRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  entry_type: LeaveLedgerEntryRecord['entryType'];
  minutes: number;
  effective_on: string;
  expires_on: string | null;
  reverses_entry_id: string | null;
  request_id: string | null;
  reason: string | null;
  created_at: Date;
  created_by_user_id: string | null;
}

const ENTRY_COLUMNS = `id, employee_id, leave_type_id, entry_type, minutes, effective_on,
  expires_on, reverses_entry_id, request_id, reason, created_at, created_by_user_id`;

function toEntry(row: EntryRow): LeaveLedgerEntryRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    entryType: row.entry_type,
    minutes: row.minutes,
    effectiveOn: row.effective_on,
    expiresOn: row.expires_on,
    reversesEntryId: row.reverses_entry_id,
    requestId: row.request_id,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
  };
}

interface GrantRuleRow {
  id: string;
  leave_type_id: string;
  service_months: number;
  minutes: number;
  created_at: Date;
}

function toGrantRule(row: GrantRuleRow): LeaveGrantRuleRecord {
  return {
    id: row.id,
    leaveTypeId: row.leave_type_id,
    serviceMonths: row.service_months,
    minutes: row.minutes,
    createdAt: row.created_at.toISOString(),
  };
}

export function createLeaveRepository(db: Queryable): LeaveRepository {
  return {
    async listLeaveTypes(workspaceId) {
      const rows = await db.query<LeaveTypeRow>(
        `SELECT ${LEAVE_TYPE_COLUMNS} FROM leave_types WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toLeaveType);
    },

    async findLeaveType(workspaceId, leaveTypeId) {
      const rows = await db.query<LeaveTypeRow>(
        `SELECT ${LEAVE_TYPE_COLUMNS} FROM leave_types WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, leaveTypeId],
      );
      const row = rows[0];
      return row ? toLeaveType(row) : null;
    },

    async updateLeaveType(workspaceId, leaveTypeId, input) {
      // 与えられた項目だけを書き換える。触れなかった設定を既定値へ戻さない。
      const rows = await db.query<LeaveTypeRow>(
        `UPDATE leave_types
            SET name = COALESCE($3, name),
                paid = COALESCE($4, paid),
                unit_minutes = CASE WHEN $5::boolean THEN $6 ELSE unit_minutes END,
                day_minutes = CASE WHEN $7::boolean THEN $8 ELSE day_minutes END,
                expires_after_months =
                  CASE WHEN $9::boolean THEN $10 ELSE expires_after_months END,
                grant_basis = CASE WHEN $11::boolean THEN $12 ELSE grant_basis END,
                auto_grant_enabled = COALESCE($13, auto_grant_enabled),
                auto_grant_from = CASE WHEN $14::boolean THEN $15::date ELSE auto_grant_from END,
                grant_fixed_month =
                  CASE WHEN $16::boolean THEN $17 ELSE grant_fixed_month END,
                grant_fixed_day = CASE WHEN $16::boolean THEN $18 ELSE grant_fixed_day END,
                active = COALESCE($19, active)
          WHERE workspace_id = $1 AND id = $2
        RETURNING ${LEAVE_TYPE_COLUMNS}`,
        [
          workspaceId,
          leaveTypeId,
          input.name ?? null,
          input.paid ?? null,
          'unitMinutes' in input,
          input.unitMinutes ?? null,
          'dayMinutes' in input,
          input.dayMinutes ?? null,
          'expiresAfterMonths' in input,
          input.expiresAfterMonths ?? null,
          'grantBasis' in input,
          input.grantBasis ?? null,
          input.autoGrantEnabled ?? null,
          'autoGrantFrom' in input,
          input.autoGrantFrom ?? null,
          // 月と日は、そろって初めて基準日になる。片方だけ書き換えない。
          'grantFixedMonth' in input || 'grantFixedDay' in input,
          input.grantFixedMonth ?? null,
          input.grantFixedDay ?? null,
          input.active ?? null,
        ],
      );
      const row = rows[0];
      return row ? toLeaveType(row) : null;
    },

    async lockLedgerOf(workspaceId, employeeId) {
      // 台帳は追記のみで、行を先取りできない。従業員の行を鍵として使う。
      await db.query('SELECT id FROM employees WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [
        workspaceId,
        employeeId,
      ]);
    },

    async listEntries(workspaceId, query) {
      const rows = await db.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM leave_ledger_entries
          WHERE workspace_id = $1 AND employee_id = $2
            AND ($3::uuid IS NULL OR leave_type_id = $3)
          ORDER BY effective_on, created_at, id`,
        [workspaceId, query.employeeId, query.leaveTypeId ?? null],
      );
      return rows.map(toEntry);
    },

    async findEntry(workspaceId, entryId) {
      const rows = await db.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM leave_ledger_entries WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, entryId],
      );
      const row = rows[0];
      return row ? toEntry(row) : null;
    },

    async addEntry(workspaceId, input) {
      const rows = await db.query<EntryRow>(
        `INSERT INTO leave_ledger_entries
           (workspace_id, employee_id, leave_type_id, entry_type, minutes, effective_on,
            expires_on, reverses_entry_id, request_id, reason, created_by_user_id, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${ENTRY_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.leaveTypeId,
          input.entryType,
          input.minutes,
          input.effectiveOn,
          input.expiresOn ?? null,
          input.reversesEntryId ?? null,
          input.requestId ?? null,
          input.reason ?? null,
          input.createdByUserId ?? null,
          input.source ?? 'manual',
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('台帳へ記録できませんでした');
      return toEntry(row);
    },

    async listEntriesForEmployees(workspaceId, employeeIds, leaveTypeId) {
      const byEmployee = new Map<string, LeaveLedgerEntryRecord[]>();
      if (employeeIds.length === 0) return byEmployee;

      const rows = await db.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM leave_ledger_entries
          WHERE workspace_id = $1 AND employee_id = ANY($2::uuid[])
            AND ($3::uuid IS NULL OR leave_type_id = $3)
          ORDER BY effective_on, created_at, id`,
        [workspaceId, employeeIds as string[], leaveTypeId ?? null],
      );
      for (const row of rows) {
        const list = byEmployee.get(row.employee_id) ?? [];
        list.push(toEntry(row));
        byEmployee.set(row.employee_id, list);
      }
      return byEmployee;
    },

    async listAutoGrantLeaveTypes(workspaceId) {
      const rows = await db.query<LeaveTypeRow>(
        `SELECT ${LEAVE_TYPE_COLUMNS} FROM leave_types
          WHERE workspace_id = $1
            AND active = true
            AND auto_grant_enabled = true
            AND grant_basis IS NOT NULL
          ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toLeaveType);
    },

    async findLastGrantRun(workspaceId, leaveTypeId) {
      const rows = await db.query<{ effective_on: string }>(
        `SELECT to_char(max(effective_on), 'YYYY-MM-DD') AS effective_on
           FROM leave_grant_runs
          WHERE workspace_id = $1 AND leave_type_id = $2`,
        [workspaceId, leaveTypeId],
      );
      return rows[0]?.effective_on ?? null;
    },

    async recordGrantRun(workspaceId, input) {
      await db.query(
        `INSERT INTO leave_grant_runs
           (workspace_id, leave_type_id, effective_on, granted_count, skipped_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, input.leaveTypeId, input.effectiveOn, input.grantedCount, input.skippedCount],
      );
    },

    async listGrantRuns(workspaceId, leaveTypeId, limit) {
      const rows = await db.query<{
        leave_type_id: string;
        effective_on: string;
        ran_at: Date;
        granted_count: number;
        skipped_count: number;
      }>(
        `SELECT leave_type_id, to_char(effective_on, 'YYYY-MM-DD') AS effective_on,
                ran_at, granted_count, skipped_count
           FROM leave_grant_runs
          WHERE workspace_id = $1 AND leave_type_id = $2
          ORDER BY effective_on DESC
          LIMIT $3`,
        [workspaceId, leaveTypeId, limit],
      );
      return rows.map((row) => ({
        leaveTypeId: row.leave_type_id,
        effectiveOn: row.effective_on,
        ranAt: row.ran_at.toISOString(),
        grantedCount: row.granted_count,
        skippedCount: row.skipped_count,
      }));
    },

    async listGrantRules(workspaceId, leaveTypeId) {
      const rows = await db.query<GrantRuleRow>(
        `SELECT id, leave_type_id, service_months, minutes, created_at
           FROM leave_grant_rules
          WHERE workspace_id = $1 AND ($2::uuid IS NULL OR leave_type_id = $2)
          ORDER BY leave_type_id, service_months`,
        [workspaceId, leaveTypeId ?? null],
      );
      return rows.map(toGrantRule);
    },

    async createGrantRule(workspaceId, input) {
      const rows = await db.query<GrantRuleRow>(
        `INSERT INTO leave_grant_rules (workspace_id, leave_type_id, service_months, minutes)
         VALUES ($1, $2, $3, $4)
         RETURNING id, leave_type_id, service_months, minutes, created_at`,
        [workspaceId, input.leaveTypeId, input.serviceMonths, input.minutes],
      );
      const row = rows[0];
      if (!row) throw new Error('付与規則を保存できませんでした');
      return toGrantRule(row);
    },

    async listGrantCandidates(workspaceId, filter) {
      const rows = await db.query<{
        id: string;
        employee_number: string;
        hired_on: string | null;
      }>(
        `SELECT id, employee_number, hired_on FROM employees
          WHERE workspace_id = $1
            AND status = 'active'
            AND ($2::uuid IS NULL OR organization_id = $2)
          ORDER BY employee_number`,
        [workspaceId, filter.organizationId ?? null],
      );
      return rows.map((row) => ({
        id: row.id,
        employeeNumber: row.employee_number,
        hiredOn: row.hired_on,
      }));
    },

    async listBulkGrantedEmployees(workspaceId, leaveTypeId, effectiveOn) {
      const rows = await db.query<{ employee_id: string }>(
        `SELECT employee_id FROM leave_ledger_entries
          WHERE workspace_id = $1 AND leave_type_id = $2 AND effective_on = $3
            AND entry_type = 'grant' AND source IN ('rule', 'import')`,
        [workspaceId, leaveTypeId, effectiveOn],
      );
      return new Set(rows.map((row) => row.employee_id));
    },

    async findEmployeeIdsByNumber(workspaceId, numbers) {
      if (numbers.length === 0) return new Map();
      const rows = await db.query<{ id: string; employee_number: string }>(
        `SELECT id, employee_number FROM employees
          WHERE workspace_id = $1 AND employee_number = ANY($2::text[])`,
        [workspaceId, numbers as string[]],
      );
      return new Map(rows.map((row) => [row.employee_number, row.id]));
    },
  };
}
