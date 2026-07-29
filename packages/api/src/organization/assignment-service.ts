import type {
  AssignmentContractRecord,
  CreateAssignmentContractRequest,
  CreateEmployeeAssignmentRequest,
  EmployeeAssignmentRecord,
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
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import { conflict, invalidRequest, notFound } from '../shared/errors.js';
import type { AssignmentRepository } from './assignment-repository.js';

export interface AssignmentServiceDependencies {
  repository: AssignmentRepository;
}

export interface AssignmentService {
  listContracts(workspaceId: string): Promise<AssignmentContractRecord[]>;
  createContract(
    workspaceId: string,
    input: CreateAssignmentContractRequest,
  ): Promise<AssignmentContractRecord>;
  listAssignments(workspaceId: string): Promise<EmployeeAssignmentRecord[]>;
  createAssignment(
    workspaceId: string,
    input: CreateEmployeeAssignmentRequest,
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

    listAssignments: (workspaceId) => deps.repository.listAssignments(workspaceId),

    async createAssignment(workspaceId, input) {
      const startsOn = requireDate(input.startsOn, 'startsOn');
      const endsOn = input.endsOn === undefined ? null : requireDate(input.endsOn, 'endsOn');
      if (endsOn !== null && endsOn < startsOn) {
        throw invalidRequest([{ field: 'endsOn', message: '終了日は開始日以降にしてください' }]);
      }

      try {
        return await deps.repository.createAssignment(workspaceId, {
          employeeId: input.employeeId,
          assignmentContractId: input.assignmentContractId,
          workplaceSiteId: input.workplaceSiteId ?? null,
          startsOn,
          endsOn,
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) throw notFound('従業員・契約・拠点のいずれか');
        throw error;
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
