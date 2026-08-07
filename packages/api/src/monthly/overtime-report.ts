import type { CalculationRuleVersionRecord, OvertimeWarningList } from '@staffweave/contracts';
import { addMonthsToBusinessDate, hasPermission, isBusinessDate } from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import type { WorkCategoryRepository } from '../schedule/work-category-repository.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { forbidden, invalidRequest } from '../shared/errors.js';
import type { MonthlyRepository } from './repository.js';
import { monthRange } from './service.js';

/**
 * 長時間労働の警告。
 *
 * 何時間を超えたら知らせるかは事業者が決める。製品は既定値を持たない。
 * 上限を置かないかぎり警告を出さず、置いていないことを応答で示す。
 * 0 件と「見ていない」を同じ形で返すと、設定漏れに気付けない。
 *
 * 見るのは法定時間外。1 日でも閾値が未設定の月は法定時間外そのものが
 * 出ないため、その月は判断できないものとして印を付ける。
 */

export interface OvertimeReportDependencies {
  repository: MonthlyRepository;
  categories: WorkCategoryRepository;
  visibility: EmployeeVisibilityGuard;
}

export interface OvertimeReportService {
  listWarnings(
    context: AuthenticatedContext,
    query: { period: string; employeeId?: string },
  ): Promise<OvertimeWarningList>;
}

/** その日に効いている版。無ければ、上限は決まっていない。 */
function ruleFor(
  versions: readonly CalculationRuleVersionRecord[],
  date: string,
): CalculationRuleVersionRecord | null {
  return versions.find((version) => version.effectiveFrom <= date) ?? null;
}

export function createOvertimeReportService(
  deps: OvertimeReportDependencies,
): OvertimeReportService {
  return {
    async listWarnings(context, query) {
      if (!hasPermission(context.roles, 'employee.read')) throw forbidden();
      if (!isBusinessDate(query.period) || !query.period.endsWith('-01')) {
        throw invalidRequest([{ field: 'period', message: '対象月は月の 1 日で指定してください' }]);
      }

      const workspaceId = context.workspace.id;
      const rule = ruleFor(
        await deps.categories.listCalculationRuleVersions(workspaceId),
        query.period,
      );
      const monthlyLimitMinutes = rule?.monthlyOvertimeLimitMinutes ?? null;
      const averageLimitMinutes = rule?.averageOvertimeLimitMinutes ?? null;
      const averageMonths = rule?.averageOvertimeMonths ?? null;

      if (monthlyLimitMinutes === null && averageLimitMinutes === null) {
        // 上限が置かれていない。0 件ではなく、見ていないことを返す。
        return {
          warnings: [],
          monthlyLimitMinutes: null,
          averageLimitMinutes: null,
          averageMonths: null,
        };
      }

      const employees = await deps.visibility.filterVisible(
        context,
        await deps.repository.listEmployeesForPeriod(workspaceId, query.employeeId),
        (employee) => employee.id,
        () => monthRange(query.period),
      );

      const warnings: OvertimeWarningList['warnings'] = [];

      for (const employee of employees) {
        const current = await overtimeOf(workspaceId, employee.id, query.period);
        const exceededMonthlyBy =
          monthlyLimitMinutes === null || current === null
            ? null
            : Math.max(0, current - monthlyLimitMinutes);

        let averageMinutes: number | null = null;
        let exceededAverageBy: number | null = null;
        if (averageLimitMinutes !== null && averageMonths !== null) {
          let total = 0;
          let unknown = false;
          for (let back = 0; back < averageMonths; back += 1) {
            const month = await overtimeOf(
              workspaceId,
              employee.id,
              addMonthsToBusinessDate(query.period, -back),
            );
            // 1 か月でも判断できない月があれば、平均も出さない。
            if (month === null) {
              unknown = true;
              break;
            }
            total += month;
          }
          averageMinutes = unknown ? null : Math.round(total / averageMonths);
          exceededAverageBy =
            averageMinutes === null ? null : Math.max(0, averageMinutes - averageLimitMinutes);
        }

        // 超えていない相手は返さない。全員を返すと、警告の一覧が名簿になる。
        if ((exceededMonthlyBy ?? 0) === 0 && (exceededAverageBy ?? 0) === 0) continue;

        warnings.push({
          employeeId: employee.id,
          employeeNumber: employee.employeeNumber,
          displayName: employee.displayName,
          period: query.period,
          legalOvertimeMinutes: current,
          exceededMonthlyBy,
          averageMinutes,
          exceededAverageBy,
        });
      }

      return { warnings, monthlyLimitMinutes, averageLimitMinutes, averageMonths };
    },
  };

  /**
   * その月の法定時間外。
   *
   * 1 日でも閾値が未設定なら `null`。0 として扱うと、
   * 「計算していない月」が「時間外の無い月」に化ける。
   */
  async function overtimeOf(
    workspaceId: string,
    employeeId: string,
    period: string,
  ): Promise<number | null> {
    const { totals } = await deps.repository.listDailyTotals(workspaceId, employeeId, period);
    let sum = 0;
    for (const day of totals) {
      if (day.legalOvertimeMinutes === null) return null;
      sum += day.legalOvertimeMinutes;
    }
    return sum;
  }
}
