import type { LaborSystemAssignmentRecord, PeriodSummaryRecord } from '@staffweave/contracts';
import type { BusinessDate, DailyTotals, PeriodBounds, PeriodKind } from '@staffweave/domain';
import {
  boundsCovering,
  differenceFromTotal,
  isBusinessDate,
  settlementPeriodOf,
  settlementPeriodsBetween,
  summarizeDays,
  weeksBetweenWithRules,
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
      partial: boolean;
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
      // 切り詰めた期間の実労働を、期間まるごとの総枠と比べても意味を持たない。
      // 差を出さず、切り詰めたことを印として返す。
      differenceMinutes: options.partial
        ? null
        : differenceFromTotal(summary.workedMinutes, options.totalMinutes),
      partial: options.partial,
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

      // 先に返す期間を決める。日次を読む範囲はそのあとで決める。
      //
      // 順序を逆にすると、要求された範囲だけを読んだうえで、それより広い
      // 清算期間の合計を出すことになる。期間の一部しか足していない値を
      // 期間まるごとの総枠と比べても、差は何も意味しない。
      const weekVersions = ruleVersions.map((version) => ({
        effectiveFrom: version.effectiveFrom,
        weekStartsOn: version.weekStartsOn,
      }));

      const weeks =
        query.kind === undefined || query.kind === 'week'
          ? weeksBetweenWithRules(query.from, query.to, weekVersions)
          : [];

      const settlements =
        query.kind === undefined || query.kind === 'settlement'
          ? assignments
              .filter(hasSettlementPeriod)
              .flatMap((assignment) =>
                settlementPeriodsBetween(
                  assignment.settlementStartsOn,
                  assignment.settlementMonths,
                  query.from,
                  query.to,
                  { from: assignment.effectiveFrom, to: assignment.effectiveTo },
                ).map((period) => ({ assignment, period })),
              )
          : [];

      // 返す期間をすべて覆う範囲を読む。週は範囲の外へはみ出し、
      // 清算期間はさらに広い。端で切ると、返した期間の一部しか足せない。
      const covering = boundsCovering([...weeks, ...settlements.map((entry) => entry.period)]) ?? {
        from: query.from,
        to: query.to,
      };

      const totals = await deps.repository.listDailyTotalsBetween(
        workspaceId,
        query.employeeId,
        covering.from,
        covering.to,
      );
      const closedDates = await deps.repository.listClosedDates(
        workspaceId,
        query.employeeId,
        covering.from,
        covering.to,
      );

      const summaries: PeriodSummaryRecord[] = [];

      for (const week of weeks) {
        summaries.push(
          toRecord(query.employeeId, 'week', week, totals, {
            // 週の総枠は、その週の始まりに効いている版が持つ法定の閾値。
            totalMinutes: ruleFor(ruleVersions, week.from)?.weeklyLegalMinutes ?? null,
            laborSystemType: null,
            closedDates,
            // 週は切り詰めない。規則の切り替えで区切り直した週も、
            // その区切りが週そのものの定義になる。
            partial: false,
          }),
        );
      }

      for (const { assignment, period } of settlements) {
        // 割当の有効日で切り詰められたかを、切り詰める前の期間と比べて決める。
        const natural = settlementPeriodOf(
          assignment.settlementStartsOn,
          assignment.settlementMonths,
          period.from,
        );
        const partial =
          natural === null || natural.from !== period.from || natural.to !== period.to;

        summaries.push(
          toRecord(query.employeeId, 'settlement', period, totals, {
            totalMinutes: assignment.settlementTotalMinutes,
            laborSystemType: assignment.systemType,
            closedDates,
            partial,
          }),
        );
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
