import type {
  AssignmentContractRecord,
  EmployeeAssignmentRecord,
  UserScopeRecord,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { BusinessDate } from '@staffweave/domain';

/**
 * 契約・配属・閲覧範囲の永続化。
 * 組織構造そのものとは別のライフサイクルを持つため、リポジトリを分ける。
 */
export interface AssignmentRepository {
  listContracts(workspaceId: string): Promise<AssignmentContractRecord[]>;
  createContract(
    workspaceId: string,
    input: {
      code: string;
      name: string;
      employerOrganizationId: string;
      hostOrganizationId: string;
      startsOn: BusinessDate;
      endsOn: BusinessDate | null;
    },
  ): Promise<AssignmentContractRecord>;

  listAssignments(workspaceId: string): Promise<EmployeeAssignmentRecord[]>;
  findAssignment(
    workspaceId: string,
    employeeAssignmentId: string,
  ): Promise<EmployeeAssignmentRecord | null>;
  /**
   * 配属を登録する。雇用元と受入組織は契約から複製するため、要求では受け取らない。
   * 契約が見つからなければ何も作らず、null を返す。
   */
  createAssignment(
    workspaceId: string,
    input: {
      employeeId: string;
      assignmentContractId: string;
      workplaceSiteId: string | null;
      startsOn: BusinessDate;
      endsOn: BusinessDate | null;
    },
  ): Promise<EmployeeAssignmentRecord | null>;
  /** 配属に終了日を設定する。契約を切り替えるとき、次の配属と期間が重ならないようにする。 */
  endAssignment(
    workspaceId: string,
    employeeAssignmentId: string,
    endsOn: BusinessDate,
  ): Promise<EmployeeAssignmentRecord>;

  listScopes(workspaceId: string): Promise<UserScopeRecord[]>;
  listScopesForUser(workspaceId: string, userId: string): Promise<string[]>;
  grantScope(
    workspaceId: string,
    input: { userId: string; organizationId: string },
  ): Promise<UserScopeRecord>;

  /**
   * 従業員ごとの「雇用元」と「受入組織」。
   * 勤務先別の閲覧権限を判定するために使う。
   */
  listEmployeeOrganizations(
    workspaceId: string,
  ): Promise<Map<string, { employerOrganizationId: string; hostOrganizationIds: string[] }>>;
}

interface ContractRow {
  id: string;
  code: string;
  name: string;
  employer_organization_id: string;
  host_organization_id: string;
  starts_on: string;
  ends_on: string | null;
  created_at: Date;
}

interface AssignmentRow {
  id: string;
  employee_id: string;
  assignment_contract_id: string;
  workplace_site_id: string | null;
  starts_on: string;
  ends_on: string | null;
}

function toContract(row: ContractRow): AssignmentContractRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    employerOrganizationId: row.employer_organization_id,
    hostOrganizationId: row.host_organization_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdAt: row.created_at.toISOString(),
  };
}

function toAssignment(row: AssignmentRow): EmployeeAssignmentRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    assignmentContractId: row.assignment_contract_id,
    workplaceSiteId: row.workplace_site_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  };
}

const CONTRACT_COLUMNS = `id, code, name, employer_organization_id, host_organization_id,
  starts_on, ends_on, created_at`;
const ASSIGNMENT_COLUMNS =
  'id, employee_id, assignment_contract_id, workplace_site_id, starts_on, ends_on';

export function createAssignmentRepository(db: Queryable): AssignmentRepository {
  return {
    async listContracts(workspaceId) {
      const rows = await db.query<ContractRow>(
        `SELECT ${CONTRACT_COLUMNS} FROM assignment_contracts
          WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toContract);
    },

    async createContract(workspaceId, input) {
      const rows = await db.query<ContractRow>(
        `INSERT INTO assignment_contracts
           (workspace_id, code, name, employer_organization_id, host_organization_id,
            starts_on, ends_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${CONTRACT_COLUMNS}`,
        [
          workspaceId,
          input.code,
          input.name,
          input.employerOrganizationId,
          input.hostOrganizationId,
          input.startsOn,
          input.endsOn,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('契約を登録できませんでした');
      return toContract(row);
    },

    async listAssignments(workspaceId) {
      const rows = await db.query<AssignmentRow>(
        `SELECT ${ASSIGNMENT_COLUMNS} FROM employee_assignments
          WHERE workspace_id = $1 ORDER BY starts_on`,
        [workspaceId],
      );
      return rows.map(toAssignment);
    },

    async createAssignment(workspaceId, input) {
      // 雇用元と受入組織は契約が決める。要求からは受け取らず、契約から複製する。
      // 契約が無ければ 0 行になり、呼び出し側が存在しない契約として扱う。
      const rows = await db.query<AssignmentRow>(
        `INSERT INTO employee_assignments
           (workspace_id, employee_id, assignment_contract_id, workplace_site_id,
            starts_on, ends_on, employer_organization_id, host_organization_id)
         SELECT $1, $2, contracts.id, $4, $5, $6,
                contracts.employer_organization_id, contracts.host_organization_id
           FROM assignment_contracts AS contracts
          WHERE contracts.workspace_id = $1 AND contracts.id = $3
         RETURNING ${ASSIGNMENT_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.assignmentContractId,
          input.workplaceSiteId,
          input.startsOn,
          input.endsOn,
        ],
      );
      return rows[0] ? toAssignment(rows[0]) : null;
    },

    async findAssignment(workspaceId, employeeAssignmentId) {
      const rows = await db.query<AssignmentRow>(
        `SELECT ${ASSIGNMENT_COLUMNS} FROM employee_assignments
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, employeeAssignmentId],
      );
      return rows[0] ? toAssignment(rows[0]) : null;
    },

    async endAssignment(workspaceId, employeeAssignmentId, endsOn) {
      const rows = await db.query<AssignmentRow>(
        `UPDATE employee_assignments SET ends_on = $3
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${ASSIGNMENT_COLUMNS}`,
        [workspaceId, employeeAssignmentId, endsOn],
      );
      const row = rows[0];
      if (!row) throw new Error('配属を更新できませんでした');
      return toAssignment(row);
    },

    async listScopes(workspaceId) {
      const rows = await db.query<{
        user_id: string;
        organization_id: string;
        granted_at: Date;
      }>(
        `SELECT user_id, organization_id, granted_at FROM user_organization_scopes
          WHERE workspace_id = $1 ORDER BY granted_at`,
        [workspaceId],
      );
      return rows.map((row) => ({
        userId: row.user_id,
        organizationId: row.organization_id,
        grantedAt: row.granted_at.toISOString(),
      }));
    },

    async listScopesForUser(workspaceId, userId) {
      const rows = await db.query<{ organization_id: string }>(
        `SELECT organization_id FROM user_organization_scopes
          WHERE workspace_id = $1 AND user_id = $2 ORDER BY organization_id`,
        [workspaceId, userId],
      );
      return rows.map((row) => row.organization_id);
    },

    async grantScope(workspaceId, input) {
      const rows = await db.query<{
        user_id: string;
        organization_id: string;
        granted_at: Date;
      }>(
        `INSERT INTO user_organization_scopes (workspace_id, user_id, organization_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id, organization_id) DO UPDATE
           SET granted_at = user_organization_scopes.granted_at
         RETURNING user_id, organization_id, granted_at`,
        [workspaceId, input.userId, input.organizationId],
      );
      const row = rows[0];
      if (!row) throw new Error('閲覧範囲を与えられませんでした');
      return {
        userId: row.user_id,
        organizationId: row.organization_id,
        grantedAt: row.granted_at.toISOString(),
      };
    },

    async listEmployeeOrganizations(workspaceId) {
      const rows = await db.query<{
        employee_id: string;
        employer_organization_id: string;
        host_organization_ids: string[] | null;
      }>(
        `SELECT employees.id AS employee_id,
                employees.organization_id AS employer_organization_id,
                array_remove(array_agg(DISTINCT contracts.host_organization_id), NULL)
                  AS host_organization_ids
           FROM employees
           LEFT JOIN employee_assignments AS assignments
             ON assignments.employee_id = employees.id
            AND assignments.workspace_id = employees.workspace_id
           LEFT JOIN assignment_contracts AS contracts
             ON contracts.id = assignments.assignment_contract_id
            AND contracts.workspace_id = employees.workspace_id
          WHERE employees.workspace_id = $1
          GROUP BY employees.id, employees.organization_id`,
        [workspaceId],
      );

      return new Map(
        rows.map((row) => [
          row.employee_id,
          {
            employerOrganizationId: row.employer_organization_id,
            hostOrganizationIds: row.host_organization_ids ?? [],
          },
        ]),
      );
    },
  };
}
