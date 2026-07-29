import type { Department, Employee, Organization, Site } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { Locale, Role } from '@staffweave/domain';

/**
 * 組織構造と従業員の永続化。
 * すべてのメソッドが workspaceId を必須で受け取り、SQL の WHERE 句へ必ず含める。
 */
export interface OrganizationRepository {
  listOrganizations(workspaceId: string): Promise<Organization[]>;
  createOrganization(
    workspaceId: string,
    input: { code: string; name: string },
  ): Promise<Organization>;

  listSites(workspaceId: string): Promise<Site[]>;
  createSite(
    workspaceId: string,
    input: { organizationId: string; code: string; name: string; timeZone: string },
  ): Promise<Site>;

  listDepartments(workspaceId: string): Promise<Department[]>;
  createDepartment(
    workspaceId: string,
    input: {
      organizationId: string;
      parentDepartmentId: string | null;
      code: string;
      name: string;
    },
  ): Promise<Department>;

  listEmployees(workspaceId: string): Promise<Employee[]>;
  createEmployee(
    workspaceId: string,
    input: {
      organizationId: string;
      userId: string | null;
      employeeNumber: string;
      displayName: string;
      primarySiteId: string | null;
      primaryDepartmentId: string | null;
      hiredOn: string | null;
    },
  ): Promise<Employee>;

  createUser(
    workspaceId: string,
    input: {
      email: string;
      passwordHash: string;
      displayName: string;
      locale: Locale;
      roles: readonly Role[];
    },
  ): Promise<{ id: string }>;

  findWorkspaceTimeZone(workspaceId: string): Promise<string | null>;
}

interface OrganizationRow {
  id: string;
  code: string;
  name: string;
  created_at: Date;
}

interface SiteRow extends OrganizationRow {
  organization_id: string;
  time_zone: string;
}

interface DepartmentRow extends OrganizationRow {
  organization_id: string;
  parent_department_id: string | null;
}

interface EmployeeRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  employee_number: string;
  display_name: string;
  primary_site_id: string | null;
  primary_department_id: string | null;
  hired_on: string | null;
  status: Employee['status'];
  created_at: Date;
}

function toOrganization(row: OrganizationRow): Organization {
  return { id: row.id, code: row.code, name: row.name, createdAt: row.created_at.toISOString() };
}

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    timeZone: row.time_zone,
    createdAt: row.created_at.toISOString(),
  };
}

function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentDepartmentId: row.parent_department_id,
    code: row.code,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  };
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    employeeNumber: row.employee_number,
    displayName: row.display_name,
    primarySiteId: row.primary_site_id,
    primaryDepartmentId: row.primary_department_id,
    hiredOn: row.hired_on,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

const EMPLOYEE_COLUMNS = `id, organization_id, user_id, employee_number, display_name,
  primary_site_id, primary_department_id, hired_on, status, created_at`;

export function createOrganizationRepository(db: Queryable): OrganizationRepository {
  return {
    async listOrganizations(workspaceId) {
      const rows = await db.query<OrganizationRow>(
        'SELECT id, code, name, created_at FROM organizations WHERE workspace_id = $1 ORDER BY code',
        [workspaceId],
      );
      return rows.map(toOrganization);
    },

    async createOrganization(workspaceId, input) {
      const rows = await db.query<OrganizationRow>(
        `INSERT INTO organizations (workspace_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id, code, name, created_at`,
        [workspaceId, input.code, input.name],
      );
      const row = rows[0];
      if (!row) throw new Error('組織を登録できませんでした');
      return toOrganization(row);
    },

    async listSites(workspaceId) {
      const rows = await db.query<SiteRow>(
        `SELECT id, organization_id, code, name, time_zone, created_at
           FROM sites WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toSite);
    },

    async createSite(workspaceId, input) {
      const rows = await db.query<SiteRow>(
        `INSERT INTO sites (workspace_id, organization_id, code, name, time_zone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, code, name, time_zone, created_at`,
        [workspaceId, input.organizationId, input.code, input.name, input.timeZone],
      );
      const row = rows[0];
      if (!row) throw new Error('拠点を登録できませんでした');
      return toSite(row);
    },

    async listDepartments(workspaceId) {
      const rows = await db.query<DepartmentRow>(
        `SELECT id, organization_id, parent_department_id, code, name, created_at
           FROM departments WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toDepartment);
    },

    async createDepartment(workspaceId, input) {
      const rows = await db.query<DepartmentRow>(
        `INSERT INTO departments (workspace_id, organization_id, parent_department_id, code, name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, parent_department_id, code, name, created_at`,
        [workspaceId, input.organizationId, input.parentDepartmentId, input.code, input.name],
      );
      const row = rows[0];
      if (!row) throw new Error('部門を登録できませんでした');
      return toDepartment(row);
    },

    async listEmployees(workspaceId) {
      const rows = await db.query<EmployeeRow>(
        `SELECT ${EMPLOYEE_COLUMNS} FROM employees
          WHERE workspace_id = $1 ORDER BY organization_id, employee_number`,
        [workspaceId],
      );
      return rows.map(toEmployee);
    },

    async createEmployee(workspaceId, input) {
      const rows = await db.query<EmployeeRow>(
        `INSERT INTO employees (
           workspace_id, organization_id, user_id, employee_number, display_name,
           primary_site_id, primary_department_id, hired_on
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${EMPLOYEE_COLUMNS}`,
        [
          workspaceId,
          input.organizationId,
          input.userId,
          input.employeeNumber,
          input.displayName,
          input.primarySiteId,
          input.primaryDepartmentId,
          input.hiredOn,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('従業員を登録できませんでした');
      return toEmployee(row);
    },

    async createUser(workspaceId, input) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO users (workspace_id, email, password_hash, display_name, locale)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [workspaceId, input.email, input.passwordHash, input.displayName, input.locale],
      );
      const row = rows[0];
      if (!row) throw new Error('利用者を登録できませんでした');

      for (const role of input.roles) {
        await db.query('INSERT INTO user_roles (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
          workspaceId,
          row.id,
          role,
        ]);
      }
      return row;
    },

    async findWorkspaceTimeZone(workspaceId) {
      const rows = await db.query<{ time_zone: string }>(
        'SELECT time_zone FROM workspaces WHERE id = $1',
        [workspaceId],
      );
      return rows[0]?.time_zone ?? null;
    },
  };
}
