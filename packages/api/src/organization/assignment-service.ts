import type {
  AssignmentContractRecord,
  CreateAssignmentContractRequest,
  CreateEmployeeAssignmentRequest,
  EmployeeAssignmentRecord,
  EndEmployeeAssignmentRequest,
  GrantUserScopeRequest,
  UserScopeRecord,
} from '@staffweave/contracts';
import type { BusinessDate } from '@staffweave/domain';
import {
  isBusinessDate,
  normalizeCode,
  validateCode,
  validateContractPeriod,
} from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import {
  isExclusionViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { conflict, invalidRequest, notFound } from '../shared/errors.js';
import type { AssignmentRepository } from './assignment-repository.js';

export interface AssignmentServiceDependencies {
  repository: AssignmentRepository;
  visibility: EmployeeVisibilityGuard;
}

export interface AssignmentService {
  listContracts(workspaceId: string): Promise<AssignmentContractRecord[]>;
  createContract(
    workspaceId: string,
    input: CreateAssignmentContractRequest,
  ): Promise<AssignmentContractRecord>;
  listAssignments(context: AuthenticatedContext): Promise<EmployeeAssignmentRecord[]>;
  createAssignment(
    workspaceId: string,
    input: CreateEmployeeAssignmentRequest,
  ): Promise<EmployeeAssignmentRecord>;
  endAssignment(
    workspaceId: string,
    employeeAssignmentId: string,
    input: EndEmployeeAssignmentRequest,
  ): Promise<EmployeeAssignmentRecord>;
  listScopes(workspaceId: string): Promise<UserScopeRecord[]>;
  grantScope(context: AuthenticatedContext, input: GrantUserScopeRequest): Promise<UserScopeRecord>;
}

function requireDate(value: string, field: string): BusinessDate {
  if (!isBusinessDate(value)) {
    throw invalidRequest([{ field, message: '日付の形式が正しくありません' }]);
  }
  return value;
}

/**
 * 配属が受け付けられなかった理由を、利用者に分かる形へ直す。
 *
 * 雇用元・受入組織は契約が決めるため、食い違いは配属の指定側の誤りとして返す。
 * 存在しない従業員も、雇用元に所属していない従業員も、DB からは同じ違反として届く。
 * どちらであっても契約の雇用元に所属していないことに変わりはないため、そう伝える。
 */
function assignmentError(error: unknown): unknown {
  if (isForeignKeyViolation(error, 'employee_assignments_employee_fkey')) {
    return invalidRequest([
      { field: 'employeeId', message: '従業員は契約の雇用元に所属している必要があります' },
    ]);
  }
  if (isForeignKeyViolation(error, 'employee_assignments_site_fkey')) {
    return invalidRequest([
      { field: 'workplaceSiteId', message: '勤務拠点は契約の受入組織の拠点から選んでください' },
    ]);
  }
  if (isExclusionViolation(error)) {
    return conflict(
      'この従業員には、期間が重なる配属がすでにあります。先に前の配属へ終了日を設定してください',
    );
  }
  if (isForeignKeyViolation(error)) return notFound('従業員・契約・拠点のいずれか');
  return error;
}

export function createAssignmentService(deps: AssignmentServiceDependencies): AssignmentService {
  return {
    listContracts: (workspaceId) => deps.repository.listContracts(workspaceId),

    async createContract(workspaceId, input) {
      if (validateCode(input.code).length > 0) {
        throw invalidRequest([
          { field: 'code', message: 'コードは英数字と - _ のみ、32 文字以内で指定してください' },
        ]);
      }

      const startsOn = requireDate(input.startsOn, 'startsOn');
      const endsOn = input.endsOn === undefined ? null : requireDate(input.endsOn, 'endsOn');
      if (validateContractPeriod({ startsOn, endsOn }).length > 0) {
        throw invalidRequest([{ field: 'endsOn', message: '終了日は開始日以降にしてください' }]);
      }

      try {
        return await deps.repository.createContract(workspaceId, {
          code: normalizeCode(input.code),
          name: input.name,
          employerOrganizationId: input.employerOrganizationId,
          hostOrganizationId: input.hostOrganizationId,
          startsOn,
          endsOn,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('この契約コードはすでに登録されています');
        if (isForeignKeyViolation(error)) throw notFound('組織');
        throw error;
      }
    },

    async listAssignments(context) {
      const assignments = await deps.repository.listAssignments(context.workspace.id);
      return deps.visibility.filterVisible(
        context,
        assignments,
        (assignment) => assignment.employeeId,
      );
    },

    async createAssignment(workspaceId, input) {
      const startsOn = requireDate(input.startsOn, 'startsOn');
      const endsOn = input.endsOn === undefined ? null : requireDate(input.endsOn, 'endsOn');
      if (endsOn !== null && endsOn < startsOn) {
        throw invalidRequest([{ field: 'endsOn', message: '終了日は開始日以降にしてください' }]);
      }

      let created: EmployeeAssignmentRecord | null;
      try {
        created = await deps.repository.createAssignment(workspaceId, {
          employeeId: input.employeeId,
          assignmentContractId: input.assignmentContractId,
          workplaceSiteId: input.workplaceSiteId ?? null,
          startsOn,
          endsOn,
        });
      } catch (error) {
        throw assignmentError(error);
      }
      if (!created) throw notFound('契約');
      return created;
    },

    async endAssignment(workspaceId, employeeAssignmentId, input) {
      const endsOn = requireDate(input.endsOn, 'endsOn');

      const existing = await deps.repository.findAssignment(workspaceId, employeeAssignmentId);
      if (!existing) throw notFound('配属');
      if (endsOn < existing.startsOn) {
        throw invalidRequest([{ field: 'endsOn', message: '終了日は開始日以降にしてください' }]);
      }

      try {
        return await deps.repository.endAssignment(workspaceId, employeeAssignmentId, endsOn);
      } catch (error) {
        throw assignmentError(error);
      }
    },

    listScopes: (workspaceId) => deps.repository.listScopes(workspaceId),

    async grantScope(context, input) {
      try {
        return await deps.repository.grantScope(context.workspace.id, input);
      } catch (error) {
        if (isForeignKeyViolation(error)) throw notFound('利用者または組織');
        throw error;
      }
    },
  };
}
