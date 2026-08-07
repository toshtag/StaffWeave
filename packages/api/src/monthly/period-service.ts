import type { LaborSystemAssignmentRecord, PeriodSummaryRecord } from '@staffweave/contracts';
import type { BusinessDate, DailyTotals, PeriodBounds, PeriodKind } from '@staffweave/domain';
import {
  differenceFromTotal,
  isBusinessDate,
  settlementPeriodsBetween,
  summarizeDays,
  weekStartOf,
  weeksBetween,
} from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import type { LaborSystemRepository } from '../schedule/labor-system-repository.js';
import type { WorkCategoryRepository } from '../schedule/work-category-repository.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { invalidRequest } from '../shared/errors.js';
import type { MonthlyRepository } from './repository.js';

/**
 * 週・清算期間・変形労働の対象期間の集計。
 *
 * 日次の計算を足し合わせるだけで、日次が正本であることは変えない。
 * 期間の区切りは設定から決まる。製品は既定値を置かないため、
 * 設定が無ければ期間そのものを返さない。
 *
 * 締めた月を含む期間も、そのまま足す。締めた月の日次は動かないため、
 * 締めた時点の値と食い違わない。含んでいることは印として返す。
 */

/** 一度に読める範囲。年単位の要求で、1 回の問い合わせが膨らむのを防ぐ。 */
export const MAXIMUM_PERIOD_DAYS = 400;

export interface PeriodServiceDependencies {
  repository: MonthlyRepository;
  laborSystems: LaborSystemRepository;
  categories: WorkCategoryRepository;
  visibility: EmployeeVisibilityGuard;
}

export interface PeriodService {
  listSummaries(
    context: AuthenticatedContext,
    query: { employeeId: string; from: string; to: string; kind?: PeriodKind },
  ): Promise<PeriodSummaryRecord[]>;
}

function requireRange(from: string, to: string): void {
  if (!isBusinessDate(from) || !isBusinessDate(to)) {
    throw invalidRequest([{ field: 'from', message: '日付の形式が正しくありません' }]);
  }
  if (from > to) {
    throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAXIMUM_PERIOD_DAYS) {
    throw invalidRequest([
      { field: 'to', message: `一度に読めるのは ${MAXIMUM_PERIOD_DAYS} 日までです` },
    ]);
  }
}

/** 清算期間を持つ割当だけ。持たない制度では、期間そのものが決まっていない。 */
function hasSettlementPeriod(
  assignment: LaborSystemAssignmentRecord,
): assignment is LaborSystemAssignmentRecord & {
  settlementStartsOn: string;
  settlementMonths: number;
} {
  return assignment.settlementStartsOn !== null && assignment.settlementMonths !== null;
}

export function createPeriodService(deps: PeriodServiceDependencies): PeriodService {
  /** 期間へ属する日次だけを取り出す。 */
  const daysWithin = (totals: readonly DailyTotals[], period: PeriodBounds): DailyTotals[] =>
    totals.filter((day) => day.businessDate >= period.from && day.businessDate <= period.to);

  const toRecord = (
    employeeId: string,
    kind: PeriodKind,
    period: PeriodBounds,
    totals: readonly DailyTotals[],
    options: {
      totalMinutes: number | null;
      laborSystemType: LaborSystemAssignmentRecord['systemType'] | null;
      closedDates: ReadonlySet<string>;
    },
  ): PeriodSummaryRecord => {
    const days = daysWithin(totals, period);
    const summary = summarizeDays(days);
    return {
      employeeId,
      kind,
      from: period.from,
      to: period.to,
      laborSystemType: options.laborSystemType,
      ...summary,
      totalMinutes: options.totalMinutes,
      differenceMinutes: differenceFromTotal(summary.workedMinutes, options.totalMinutes),
      includesClosedMonth: days.some((day) => options.closedDates.has(day.businessDate)),
    };
  };

  return {
    async listSummaries(context, query) {
      requireRange(query.from, query.to);
      await deps.visibility.requireVisibleEmployee(context, query.employeeId, {
        from: query.from,
        to: query.to,
      });

      const workspaceId = context.workspace.id;
      const ruleVersions = await deps.categories.listCalculationRuleVersions(workspaceId);
      const assignments = await deps.laborSystems.list(workspaceId, query.employeeId);

      // 週は範囲の外へはみ出す。日次はその端まで読む。
      // 端で切ると、月末で切った週の合計が「その週に働いた時間」ではなくなる。
      const weekStartsOn = ruleFor(ruleVersions, query.from)?.weekStartsOn ?? 0;
      const readFrom = weekStartOf(query.from, weekStartsOn);
      const readTo = weeksBetween(query.from, query.to, weekStartsOn).at(-1)?.to ?? query.to;

      const totals = await deps.repository.listDailyTotalsBetween(
        workspaceId,
        query.employeeId,
        readFrom,
        readTo,
      );
      const closedDates = await deps.repository.listClosedDates(
        workspaceId,
        query.employeeId,
        readFrom,
        readTo,
      );

      const summaries: PeriodSummaryRecord[] = [];

      if (query.kind === undefined || query.kind === 'week') {
        for (const week of weeksBetween(query.from, query.to, weekStartsOn)) {
          summaries.push(
            toRecord(query.employeeId, 'week', week, totals, {
              // 週の総枠は、その週の始まりに効いている版が持つ法定の閾値。
              totalMinutes: ruleFor(ruleVersions, week.from)?.weeklyLegalMinutes ?? null,
              laborSystemType: null,
              closedDates,
            }),
          );
        }
      }

      if (query.kind === undefined || query.kind === 'settlement') {
        for (const assignment of assignments) {
          if (!hasSettlementPeriod(assignment)) continue;
          const periods = settlementPeriodsBetween(
            assignment.settlementStartsOn,
            assignment.settlementMonths,
            query.from,
            query.to,
            { from: assignment.effectiveFrom, to: assignment.effectiveTo },
          );
          for (const period of periods) {
            summaries.push(
              toRecord(query.employeeId, 'settlement', period, totals, {
                totalMinutes: assignment.settlementTotalMinutes,
                laborSystemType: assignment.systemType,
                closedDates,
              }),
            );
          }
        }
      }

      return summaries.sort((left, right) =>
        left.kind === right.kind
          ? left.from.localeCompare(right.from)
          : left.kind.localeCompare(right.kind),
      );
    },
  };
}

/**
 * その日に効いている計算規則の版。
 *
 * 版は新しい順に並んでいる。適用開始日がその日以前で、いちばん新しいものを採る。
 * 無ければ、週の区切りも法定の閾値も決まっていない。
 */
function ruleFor<T extends { effectiveFrom: string }>(
  versions: readonly T[],
  date: BusinessDate,
): T | null {
  return versions.find((version) => version.effectiveFrom <= date) ?? null;
}
