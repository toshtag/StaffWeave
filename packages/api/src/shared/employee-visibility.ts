/**
 * 従業員データの閲覧範囲。
 *
 * 「誰の勤怠を見てよいか」はロールと閲覧範囲で決まる。判断はここに集約し、
 * 各サービスへ複製しない。複製すると、一箇所を直しても別の経路が残る。
 *
 * ドメインの {@link resolveEmployeeVisibility} が規則を持ち、ここでは
 * 認証コンテキストからの変換と、DB への問い合わせを受け持つ。
 */
import type { QueryParameter } from '@staffweave/db';
import type { EmployeeVisibility } from '@staffweave/domain';
import {
  isEmployeeVisible,
  resolveEmployeeVisibility,
  seesWholeWorkspace,
} from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import type { AssignmentRepository } from '../organization/assignment-repository.js';
import { forbidden } from './errors.js';

/** 認証コンテキストから閲覧範囲を導く。 */
export function employeeVisibilityOf(context: AuthenticatedContext): EmployeeVisibility {
  return resolveEmployeeVisibility({
    roles: context.roles,
    organizationIds: context.organizationScopes,
    selfEmployeeId: context.employee?.id ?? null,
  });
}

export interface EmployeeVisibilityGuard {
  of(context: AuthenticatedContext): EmployeeVisibility;
  /** 特定の従業員を対象にする処理の入口で使う。見られない相手なら 403。 */
  requireVisibleEmployee(context: AuthenticatedContext, employeeId: string): Promise<void>;
  /**
   * 一覧から見てよい行だけを残す。
   * `employeeIdOf` が null を返す行は、特定の従業員に紐づかないものとして残す。
   */
  filterVisible<T>(
    context: AuthenticatedContext,
    items: readonly T[],
    employeeIdOf: (item: T) => string | null,
  ): Promise<T[]>;
}

export function createEmployeeVisibilityGuard(
  assignments: AssignmentRepository,
): EmployeeVisibilityGuard {
  return {
    of: employeeVisibilityOf,

    async requireVisibleEmployee(context, employeeId) {
      const visibility = employeeVisibilityOf(context);
      // 組織の対応を読まずに判断できる場合は、問い合わせを省く。
      if (isEmployeeVisible(visibility, employeeId)) return;
      if (visibility.kind !== 'organizations') throw forbidden();

      const organizations = await assignments.listEmployeeOrganizations(context.workspace.id);
      if (!isEmployeeVisible(visibility, employeeId, organizations.get(employeeId))) {
        throw forbidden();
      }
    },

    async filterVisible(context, items, employeeIdOf) {
      const visibility = employeeVisibilityOf(context);
      if (seesWholeWorkspace(visibility)) return [...items];

      const organizations =
        visibility.kind === 'organizations'
          ? await assignments.listEmployeeOrganizations(context.workspace.id)
          : undefined;

      return items.filter((item) => {
        const employeeId = employeeIdOf(item);
        if (employeeId === null) return true;
        return isEmployeeVisible(visibility, employeeId, organizations?.get(employeeId));
      });
    },
  };
}

export interface VisibilityConditionOptions {
  /** 従業員 ID を表す SQL 式。例: `employees.id` */
  employeeIdExpression: string;
  /** ワークスペース ID を表す SQL 式。例: `employees.workspace_id` */
  workspaceIdExpression: string;
  /** この条件で使い始める位置パラメータの番号。 */
  firstParameterIndex: number;
}

/**
 * 閲覧範囲を SQL の条件として表す。
 *
 * 件数が多くなる出力では、ワークスペース全件を読み込んでから捨てるのではなく、
 * DB の側で絞り込む。読み込まなかったものは、取り違えようがない。
 *
 * 判定の意味は {@link AssignmentRepository.listEmployeeOrganizations} と同じにする。
 * 雇用元は従業員の所属組織、受入組織は配属された契約の受入先を指す。
 */
export function employeeVisibilityCondition(
  visibility: EmployeeVisibility,
  options: VisibilityConditionOptions,
): { sql: string; parameters: QueryParameter[] } {
  const { employeeIdExpression, workspaceIdExpression, firstParameterIndex } = options;

  switch (visibility.kind) {
    case 'workspace':
      return { sql: 'TRUE', parameters: [] };
    case 'none':
      return { sql: 'FALSE', parameters: [] };
    case 'self':
      return {
        sql: `${employeeIdExpression} = $${firstParameterIndex}`,
        parameters: [visibility.employeeId],
      };
    case 'organizations': {
      const conditions: string[] = [];
      const parameters: QueryParameter[] = [];

      if (visibility.organizationIds.length > 0) {
        const index = firstParameterIndex + parameters.length;
        parameters.push([...visibility.organizationIds]);
        conditions.push(`EXISTS (
          SELECT 1
            FROM employees AS visible_employee
           WHERE visible_employee.id = ${employeeIdExpression}
             AND visible_employee.workspace_id = ${workspaceIdExpression}
             AND (
               visible_employee.organization_id = ANY($${index}::uuid[])
               OR EXISTS (
                 SELECT 1
                   FROM employee_assignments AS visible_assignment
                   JOIN assignment_contracts AS visible_contract
                     ON visible_contract.id = visible_assignment.assignment_contract_id
                    AND visible_contract.workspace_id = visible_assignment.workspace_id
                  WHERE visible_assignment.employee_id = visible_employee.id
                    AND visible_assignment.workspace_id = visible_employee.workspace_id
                    AND visible_contract.host_organization_id = ANY($${index}::uuid[])
               )
             )
        )`);
      }

      if (visibility.selfEmployeeId !== null) {
        const index = firstParameterIndex + parameters.length;
        parameters.push(visibility.selfEmployeeId);
        conditions.push(`${employeeIdExpression} = $${index}`);
      }

      if (conditions.length === 0) return { sql: 'FALSE', parameters: [] };
      return { sql: `(${conditions.join(' OR ')})`, parameters };
    }
  }
}
