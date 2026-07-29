/**
 * 雇用元と受入組織、そのあいだの契約と配属。
 *
 * 従業員が所属する組織（雇用元）と、実際に働く組織（受入組織）は同じとは限らない。
 * 派遣や出向では別々になり、勤怠を見てよい人も両方に現れる。
 * ここでは「いつ・どこへ配属されているか」と「誰がその勤怠を見てよいか」を決める規則だけを持つ。
 */
import type { BusinessDate } from '../attendance/business-date.js';

export interface AssignmentContract {
  id: string;
  /** 従業員を雇用している組織。 */
  employerOrganizationId: string;
  /** 従業員を受け入れる組織。雇用元と同じこともある。 */
  hostOrganizationId: string;
  startsOn: BusinessDate;
  /** 終わりが決まっていなければ null。 */
  endsOn: BusinessDate | null;
}

export interface EmployeeAssignment {
  id: string;
  employeeId: string;
  assignmentContractId: string;
  /** 実際に勤務する拠点。決まっていなければ null。 */
  workplaceSiteId: string | null;
  startsOn: BusinessDate;
  endsOn: BusinessDate | null;
}

function coversDate(
  period: { startsOn: BusinessDate; endsOn: BusinessDate | null },
  businessDate: BusinessDate,
): boolean {
  return (
    period.startsOn <= businessDate && (period.endsOn === null || businessDate <= period.endsOn)
  );
}

/** その業務日に有効な契約かどうか。 */
export function contractCoversDate(
  contract: AssignmentContract,
  businessDate: BusinessDate,
): boolean {
  return coversDate(contract, businessDate);
}

/**
 * その業務日に有効な配属を選ぶ。
 * 重なっている場合は開始日が後のものを採用する。配属の切り替え日を境に、新しい配属が効く。
 */
export function activeAssignmentAt(
  assignments: readonly EmployeeAssignment[],
  businessDate: BusinessDate,
): EmployeeAssignment | null {
  const applicable = assignments.filter((assignment) => coversDate(assignment, businessDate));
  if (applicable.length === 0) return null;
  return applicable.reduce((latest, assignment) =>
    assignment.startsOn > latest.startsOn ? assignment : latest,
  );
}

export interface EmployeeOrganizationView {
  /** 従業員が所属する組織。 */
  employerOrganizationId: string;
  /** 配属によって関わる受入組織。複数の契約があれば複数になる。 */
  hostOrganizationIds: readonly string[];
}

/**
 * 勤務先別の閲覧権限。
 *
 * 閲覧できる組織を持たない利用者は、ワークスペース全体を見られる（管理者を想定）。
 * 組織を指定された利用者は、その組織が雇用元か受入組織である従業員だけを見られる。
 * 受入組織側の承認者（外部承認者）も、この仕組みで表す。
 */
export function canAccessEmployee(
  scopedOrganizationIds: readonly string[],
  employee: EmployeeOrganizationView,
): boolean {
  if (scopedOrganizationIds.length === 0) return true;
  if (scopedOrganizationIds.includes(employee.employerOrganizationId)) return true;
  return employee.hostOrganizationIds.some((id) => scopedOrganizationIds.includes(id));
}

export type ContractProblem = 'invalid_period' | 'same_organization_without_reason';

export function validateContractPeriod(input: {
  startsOn: BusinessDate;
  endsOn: BusinessDate | null;
}): ContractProblem[] {
  if (input.endsOn !== null && input.endsOn < input.startsOn) return ['invalid_period'];
  return [];
}
