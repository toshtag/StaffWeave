/**
 * 雇用元と受入組織、そのあいだの契約と配属。
 *
 * 従業員が所属する組織（雇用元）と、実際に働く組織（受入組織）は同じとは限らない。
 * 派遣や出向では別々になり、勤怠を見てよい人も両方に現れる。
 * ここでは「いつ・どこへ配属されているか」と「誰がその勤怠を見てよいか」を決める規則だけを持つ。
 */
import type { BusinessDate } from '../attendance/business-date.js';
import type { Role } from '../identity/roles.js';

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

/**
 * 閲覧の判断に使う対象期間。
 *
 * 1 日だけを見る経路では `from` と `to` に同じ業務日を渡す。
 * 期間を見る経路では、その期間と配属期間が重なるかどうかで判断する。
 */
export interface AccessPeriod {
  from: BusinessDate;
  to: BusinessDate;
}

function overlapsPeriod(
  span: { startsOn: BusinessDate; endsOn: BusinessDate | null },
  period: AccessPeriod,
): boolean {
  return span.startsOn <= period.to && (span.endsOn === null || period.from <= span.endsOn);
}

/** 配属によって受入組織と関わっていた期間。契約と配属の両方が続いているあいだだけ。 */
export interface HostOrganizationPeriod {
  organizationId: string;
  startsOn: BusinessDate;
  /** 終わりが決まっていなければ null。 */
  endsOn: BusinessDate | null;
}

export interface EmployeeOrganizationView {
  /** 従業員が所属する組織。 */
  employerOrganizationId: string;
  /** 配属によって関わる受入組織と、その期間。複数の契約があれば複数になる。 */
  hostOrganizations: readonly HostOrganizationPeriod[];
}

/**
 * 指定した組織のいずれかが、その期間にその従業員の雇用元か受入組織かどうか。
 *
 * 空の配列は「どの組織も指定されていない」という意味であり、「すべて」ではない。
 * 空の配列を渡した場合は常に false になる。
 * 誰をどこまで見られるかの判断は {@link resolveEmployeeVisibility} が決める。
 *
 * 雇用元は期間で絞らない。所属している限り、雇用元は自社の従業員として扱う。
 * 受入組織は配属の期間だけに限る。契約が始まる前と終わった後は関わりが無い。
 */
export function canAccessEmployee(
  scopedOrganizationIds: readonly string[],
  employee: EmployeeOrganizationView,
  period: AccessPeriod,
): boolean {
  if (scopedOrganizationIds.includes(employee.employerOrganizationId)) return true;
  return employee.hostOrganizations.some(
    (host) => scopedOrganizationIds.includes(host.organizationId) && overlapsPeriod(host, period),
  );
}

/**
 * 従業員データをどこまで見られるかを表す。
 *
 * 「組織の指定がない」ことと「全体を見られる」ことは別の状態である。
 * ひとつの空配列に両方の意味を持たせると、閲覧範囲をまだ与えられていない
 * 組織管理者がワークスペース全体を見られてしまう。そのため状態として区別する。
 */
export type EmployeeVisibility =
  /** ワークスペース全体。ワークスペース管理者。 */
  | { kind: 'workspace' }
  /**
   * 指定された組織が雇用元か受入組織である従業員。組織管理者。
   * `organizationIds` が空なら管理対象はない。
   * 自分自身の従業員データは、閲覧範囲とは別に見られる。
   */
  | {
      kind: 'organizations';
      organizationIds: readonly string[];
      selfEmployeeId: string | null;
    }
  /** 自分自身だけ。一般従業員。 */
  | { kind: 'self'; employeeId: string }
  /** 誰も見られない。従業員が紐づいていない一般利用者。 */
  | { kind: 'none' };

/**
 * ロールと閲覧範囲から、見られる相手を決める。
 *
 * ロールは「誰が何をできるか」を決める唯一の根拠であり、
 * 閲覧範囲の有無からロールを推定しない。
 */
export function resolveEmployeeVisibility(input: {
  roles: readonly Role[];
  organizationIds: readonly string[];
  selfEmployeeId: string | null;
}): EmployeeVisibility {
  if (input.roles.includes('workspace_admin')) return { kind: 'workspace' };
  if (input.roles.includes('organization_manager')) {
    return {
      kind: 'organizations',
      organizationIds: [...input.organizationIds],
      selfEmployeeId: input.selfEmployeeId,
    };
  }
  if (input.selfEmployeeId === null) return { kind: 'none' };
  return { kind: 'self', employeeId: input.selfEmployeeId };
}

/**
 * その期間についてその従業員を見てよいかどうか。
 *
 * `organizations` を渡さなかった場合、組織の対応が分からない従業員として扱い、
 * 自分自身でない限り見られない。
 */
export function isEmployeeVisible(
  visibility: EmployeeVisibility,
  employeeId: string,
  organizations?: EmployeeOrganizationView | undefined,
  period?: AccessPeriod | undefined,
): boolean {
  switch (visibility.kind) {
    case 'workspace':
      return true;
    case 'none':
      return false;
    case 'self':
      return visibility.employeeId === employeeId;
    case 'organizations':
      if (visibility.selfEmployeeId === employeeId) return true;
      if (organizations === undefined || period === undefined) return false;
      return canAccessEmployee(visibility.organizationIds, organizations, period);
  }
}

/** ワークスペース全体を見られるかどうか。一覧の絞り込みを省いてよいかの判断に使う。 */
export function seesWholeWorkspace(visibility: EmployeeVisibility): boolean {
  return visibility.kind === 'workspace';
}

export type ContractProblem = 'invalid_period' | 'same_organization_without_reason';

export function validateContractPeriod(input: {
  startsOn: BusinessDate;
  endsOn: BusinessDate | null;
}): ContractProblem[] {
  if (input.endsOn !== null && input.endsOn < input.startsOn) return ['invalid_period'];
  return [];
}
