import type {
  CreateDepartmentRequest,
  CreateEmployeeRequest,
  CreateOrganizationRequest,
  CreateSiteRequest,
  Department,
  Employee,
  Organization,
  Site,
} from '@staffweave/contracts';
import type { Role } from '@staffweave/domain';
import {
  DEFAULT_LOCALE,
  isValidEmail,
  normalizeCode,
  normalizeEmail,
  validateCode,
  validatePassword,
} from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { conflict, invalidRequest, notFound } from '../shared/errors.js';
import { hashPassword } from '../shared/security/password.js';
import type { OrganizationRepository } from './repository.js';

export interface OrganizationServiceDependencies {
  repository: OrganizationRepository;
  visibility: EmployeeVisibilityGuard;
  /** 複数テーブルへまたがる登録をまとめるためのトランザクション境界。 */
  transaction<T>(fn: (repository: OrganizationRepository) => Promise<T>): Promise<T>;
}

export interface OrganizationService {
  listOrganizations(workspaceId: string): Promise<Organization[]>;
  createOrganization(workspaceId: string, input: CreateOrganizationRequest): Promise<Organization>;
  listSites(workspaceId: string): Promise<Site[]>;
  createSite(workspaceId: string, input: CreateSiteRequest): Promise<Site>;
  listDepartments(workspaceId: string): Promise<Department[]>;
  createDepartment(workspaceId: string, input: CreateDepartmentRequest): Promise<Department>;
  listEmployees(context: AuthenticatedContext): Promise<Employee[]>;
  createEmployee(workspaceId: string, input: CreateEmployeeRequest): Promise<Employee>;
}

function requireValidCode(field: string, code: string): string {
  const problems = validateCode(code);
  if (problems.length > 0) {
    throw invalidRequest([
      { field, message: 'コードは英数字と - _ のみ、32 文字以内で指定してください' },
    ]);
  }
  return normalizeCode(code);
}

export function createOrganizationService(
  deps: OrganizationServiceDependencies,
): OrganizationService {
  const { repository } = deps;

  return {
    listOrganizations: (workspaceId) => repository.listOrganizations(workspaceId),

    async createOrganization(workspaceId, input) {
      const code = requireValidCode('code', input.code);
      try {
        return await repository.createOrganization(workspaceId, { code, name: input.name });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(`コード ${code} の組織はすでに登録されています`);
        }
        throw error;
      }
    },

    listSites: (workspaceId) => repository.listSites(workspaceId),

    async createSite(workspaceId, input) {
      const code = requireValidCode('code', input.code);
      const timeZone = input.timeZone ?? (await repository.findWorkspaceTimeZone(workspaceId));
      if (!timeZone) throw notFound('ワークスペース');

      try {
        return await repository.createSite(workspaceId, {
          organizationId: input.organizationId,
          code,
          name: input.name,
          timeZone,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(`コード ${code} の拠点はすでに登録されています`);
        }
        // 別ワークスペースの組織を指した場合も外部キー違反になる。存在しない扱いとする。
        if (isForeignKeyViolation(error)) throw notFound('組織');
        throw error;
      }
    },

    listDepartments: (workspaceId) => repository.listDepartments(workspaceId),

    async createDepartment(workspaceId, input) {
      const code = requireValidCode('code', input.code);
      try {
        return await repository.createDepartment(workspaceId, {
          organizationId: input.organizationId,
          parentDepartmentId: input.parentDepartmentId ?? null,
          code,
          name: input.name,
        });
      } catch (error) {
        if (isForeignKeyViolation(error, 'departments_parent_fkey')) {
          throw invalidRequest([
            { field: 'parentDepartmentId', message: '親部門は同じ組織の部門から選んでください' },
          ]);
        }
        if (isUniqueViolation(error)) {
          throw conflict(`コード ${code} の部門はすでに登録されています`);
        }
        if (isForeignKeyViolation(error)) throw notFound('組織または親部門');
        throw error;
      }
    },

    /** 従業員の一覧は、その利用者が見てよい相手だけを返す。 */
    async listEmployees(context) {
      const employees = await repository.listEmployees(context.workspace.id);
      return deps.visibility.filterVisible(context, employees, (employee) => employee.id);
    },

    async createEmployee(workspaceId, input) {
      const employeeNumber = requireValidCode('employeeNumber', input.employeeNumber);

      let passwordHash: string | undefined;
      let email: string | undefined;
      let roles: Role[] = [];

      if (input.account) {
        email = normalizeEmail(input.account.email);
        if (!isValidEmail(email)) {
          throw invalidRequest([
            { field: 'account.email', message: 'メールアドレスの形式が正しくありません' },
          ]);
        }
        const passwordProblems = validatePassword(input.account.password);
        if (passwordProblems.length > 0) {
          throw invalidRequest([
            {
              field: 'account.password',
              message: 'パスワードは 12 文字以上で、同じ文字の繰り返しを避けてください',
            },
          ]);
        }
        passwordHash = await hashPassword(input.account.password);
        roles = [...(input.account.roles ?? ['employee'])];
      }

      const accountEmail = email;
      const accountPasswordHash = passwordHash;
      const accountLocale = input.account?.locale ?? DEFAULT_LOCALE;

      try {
        return await deps.transaction(async (repositoryInTransaction) => {
          let userId: string | null = null;
          if (accountEmail !== undefined && accountPasswordHash !== undefined) {
            const user = await repositoryInTransaction.createUser(workspaceId, {
              email: accountEmail,
              passwordHash: accountPasswordHash,
              displayName: input.displayName,
              locale: accountLocale,
              roles,
            });
            userId = user.id;
          }

          return repositoryInTransaction.createEmployee(workspaceId, {
            organizationId: input.organizationId,
            userId,
            employeeNumber,
            displayName: input.displayName,
            primarySiteId: input.primarySiteId ?? null,
            primaryDepartmentId: input.primaryDepartmentId ?? null,
            hiredOn: input.hiredOn ?? null,
          });
        });
      } catch (error) {
        if (isUniqueViolation(error, 'users_workspace_email_key')) {
          throw conflict('このメールアドレスの利用者はすでに登録されています');
        }
        if (isUniqueViolation(error)) {
          throw conflict(`従業員番号 ${employeeNumber} はすでに使われています`);
        }
        throw employeeReferenceError(error);
      }
    },
  };
}

/**
 * 従業員の参照先が受け付けられなかった理由を、利用者に分かる形へ直す。
 *
 * 主拠点と主部門は所属組織のものに限る。制約は DB が持つため、
 * 存在しない拠点も、別の組織の拠点も、同じ外部キー違反として届く。
 * どちらであっても「所属組織の拠点ではない」ことに変わりはないため、そう伝える。
 */
function employeeReferenceError(error: unknown): unknown {
  if (isForeignKeyViolation(error, 'employees_site_fkey')) {
    return invalidRequest([
      { field: 'primarySiteId', message: '主拠点は所属組織の拠点から選んでください' },
    ]);
  }
  if (isForeignKeyViolation(error, 'employees_department_fkey')) {
    return invalidRequest([
      { field: 'primaryDepartmentId', message: '主部門は所属組織の部門から選んでください' },
    ]);
  }
  if (isForeignKeyViolation(error)) return notFound('組織・拠点・部門のいずれか');
  return error;
}
