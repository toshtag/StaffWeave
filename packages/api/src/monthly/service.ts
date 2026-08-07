import type {
  AttendanceEventRecord,
  ClosingReadiness,
  MonthlySummaryRecord,
  RecalculateAttendanceRequest,
  RecalculateAttendanceResponse,
} from '@staffweave/contracts';
import type { ClosingDayState, MonthlySummary } from '@staffweave/domain';
import {
  addDaysToBusinessDate,
  findClosingBlockers,
  hasBlockingFindings,
  hasPermission,
  isBusinessDate,
  resolveEffectiveEvents,
  summarizeMonth,
  summarizeWorkDay,
} from '@staffweave/domain';
import type { DayRepositories } from '../attendance/day.js';
import { recalculateWorkDay } from '../attendance/day.js';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest } from '../shared/errors.js';
import type { MonthlyRepository } from './repository.js';

/**
 * 月次の集計、締め前の確認、再計算。
 *
 * 月次は日次から導く。締めたときの値だけは別に固める。
 * 締めたあとに打刻を直すと日次は新しい版になるが、給与へ渡した値は変わらない。
 * 両方を並べて出し、どちらが締めた値なのかを人が見て分かるようにする。
 */

export interface MonthlyRepositories {
  monthly: MonthlyRepository;
  attendance: DayRepositories['attendance'];
  schedule: DayRepositories['schedule'];
  calculations: DayRepositories['calculations'];
  approval: DayRepositories['approval'];
  requests: DayRepositories['requests'];
  categories: DayRepositories['categories'];
  audit: AuditRepository;
}

export interface MonthlyServiceDependencies {
  repository: MonthlyRepository;
  attendance: DayRepositories['attendance'];
  visibility: EmployeeVisibilityGuard;
  transaction<T>(fn: (repositories: MonthlyRepositories) => Promise<T>): Promise<T>;
}

export interface MonthlyService {
  listSummaries(
    context: AuthenticatedContext,
    query: { employeeId?: string; period: string },
  ): Promise<MonthlySummaryRecord[]>;
  listReadiness(
    context: AuthenticatedContext,
    query: { employeeId?: string; period: string },
  ): Promise<ClosingReadiness[]>;
  recalculate(
    context: AuthenticatedContext,
    input: RecalculateAttendanceRequest,
  ): Promise<RecalculateAttendanceResponse>;
}

/** 対象月の最初と最後の日。閲覧範囲の判断に使う。 */
export function monthRange(period: string): { from: string; to: string } {
  const [year, month] = period.split('-').map(Number);
  if (year === undefined || month === undefined) {
    throw invalidRequest([{ field: 'period', message: '対象月として読み取れません' }]);
  }
  const nextMonth =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { from: period, to: addDaysToBusinessDate(nextMonth, -1) };
}

function requirePeriod(period: string): string {
  if (!isBusinessDate(period) || !period.endsWith('-01')) {
    throw invalidRequest([{ field: 'period', message: '対象月は月の 1 日で指定してください' }]);
  }
  return period;
}

/** 締めた値と、いまの値が食い違っているか。 */
export function driftsFrom(snapshot: MonthlySummary, current: MonthlySummary): boolean {
  const keys = Object.keys(current) as (keyof MonthlySummary)[];
  return keys.some((key) => key !== 'period' && snapshot[key] !== current[key]);
}

export function createMonthlyService(deps: MonthlyServiceDependencies): MonthlyService {
  /** その月に関わりのある従業員だけへ絞る。 */
  const visibleEmployees = async (
    context: AuthenticatedContext,
    query: { employeeId?: string; period: string },
  ): Promise<{ id: string; employeeNumber: string; displayName: string }[]> => {
    if (query.employeeId !== undefined && !hasPermission(context.roles, 'employee.read')) {
      // 自分の分だけは、権限が無くても見られる。
      if (query.employeeId !== context.employee?.id) throw forbidden();
    }
    if (query.employeeId === undefined && !hasPermission(context.roles, 'employee.read')) {
      const self = context.employee?.id;
      if (self === undefined) throw forbidden();
      return deps.repository.listEmployeesForPeriod(context.workspace.id, self);
    }

    const employees = await deps.repository.listEmployeesForPeriod(
      context.workspace.id,
      query.employeeId,
    );
    const period = monthRange(query.period);
    return deps.visibility.filterVisible(
      context,
      employees,
      (employee) => employee.id,
      () => period,
    );
  };

  const summaryOf = async (
    workspaceId: string,
    employee: { id: string; employeeNumber: string; displayName: string },
    period: string,
  ): Promise<MonthlySummaryRecord> => {
    const [{ totals }, snapshot, closing] = await Promise.all([
      deps.repository.listDailyTotals(workspaceId, employee.id, period),
      deps.repository.findLatestSnapshot(workspaceId, employee.id, period),
      deps.repository.findClosingState(workspaceId, employee.id, period),
    ]);
    const current = summarizeMonth(period, totals);

    return {
      employeeId: employee.id,
      employeeNumber: employee.employeeNumber,
      displayName: employee.displayName,
      ...current,
      closingState: closing,
      snapshot:
        snapshot === null
          ? null
          : {
              sequence: snapshot.sequence,
              closedAt: snapshot.closedAt,
              closedByUserId: snapshot.closedByUserId,
              ...snapshot.summary,
            },
      driftedFromSnapshot: snapshot !== null && driftsFrom(snapshot.summary, current),
    };
  };

  return {
    async listSummaries(context, query) {
      const period = requirePeriod(query.period);
      const employees = await visibleEmployees(context, { ...query, period });
      return Promise.all(
        employees.map((employee) => summaryOf(context.workspace.id, employee, period)),
      );
    },

    async listReadiness(context, query) {
      const period = requirePeriod(query.period);
      const employees = await visibleEmployees(context, { ...query, period });

      return Promise.all(
        employees.map(async (employee) => {
          const [events, requests] = await Promise.all([
            deps.repository.listMonthEvents(context.workspace.id, employee.id, period),
            deps.repository.listMonthRequestStates(context.workspace.id, employee.id, period),
          ]);

          const days: ClosingDayState[] = [...events.entries()].map(
            ([businessDate, dayEvents]) => ({
              businessDate,
              ...stateOfDay(businessDate, dayEvents),
              requestState: requests.get(businessDate) ?? null,
            }),
          );

          const findings = findClosingBlockers(days);
          return {
            employeeId: employee.id,
            period,
            findings,
            blocked: hasBlockingFindings(findings),
          };
        }),
      );
    },

    async recalculate(context, input) {
      if (!hasPermission(context.roles, 'employee.manage')) throw forbidden();
      if (!isBusinessDate(input.from) || !isBusinessDate(input.to)) {
        throw invalidRequest([{ field: 'from', message: '日付の形式が正しくありません' }]);
      }
      if (input.from > input.to) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }
      // 期間を無制限にすると、1 回の要求で年単位の再計算が走る。
      // 途中で切れたときにどこまで進んだかが分からなくなるため、月単位に区切らせる。
      const days = dateRange(input.from, input.to);
      if (days.length > 62) {
        throw invalidRequest([{ field: 'to', message: '一度に再計算できるのは 62 日までです' }]);
      }

      await deps.visibility.requireVisibleEmployee(context, input.employeeId, {
        from: input.from,
        to: input.to,
      });

      const timeZone = await deps.attendance.findTimeZoneForEmployee(
        context.workspace.id,
        input.employeeId,
      );
      if (timeZone === null) throw new ApiError('not_found', '従業員が見つかりません');

      return deps.transaction(async (repositories) => {
        const [closed, withData] = await Promise.all([
          repositories.monthly.listClosedDates(
            context.workspace.id,
            input.employeeId,
            input.from,
            input.to,
          ),
          repositories.monthly.listDatesWithData(
            context.workspace.id,
            input.employeeId,
            input.from,
            input.to,
          ),
        ]);

        const skippedClosedDays: string[] = [];
        let recalculatedDays = 0;

        for (const businessDate of days) {
          // 締めた日は動かさない。締めた値と給与へ渡した値が食い違う。
          if (closed.has(businessDate)) {
            skippedClosedDays.push(businessDate);
            continue;
          }
          // 打刻も予定も過去の計算も無い日は、やり直しても何も出ない。
          if (!withData.has(businessDate)) continue;
          const before = await repositories.calculations.findLatest(
            context.workspace.id,
            input.employeeId,
            businessDate,
          );
          const day = await recalculateWorkDay(
            repositories,
            context.workspace.id,
            input.employeeId,
            businessDate,
            timeZone,
          );
          // 入力が変わらなければ新しい版は作られない。数えるのは作られた日だけ。
          if (day.calculation !== null && day.calculation.version !== (before?.version ?? 0)) {
            recalculatedDays += 1;
          }
        }

        await repositories.audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'attendance_calculation.recalculated',
          targetType: 'employee',
          targetId: input.employeeId,
          summary: `${input.from} から ${input.to} の集計をやり直しました`,
          detail: {
            employeeId: input.employeeId,
            from: input.from,
            to: input.to,
            recalculatedDays,
            skippedClosedDays,
          },
        });

        return { examinedDays: days.length, recalculatedDays, skippedClosedDays };
      });
    },
  };
}

/** 打刻から、締める前に見たい状態を作る。有効な記録の判断はドメインへ任せる。 */
function stateOfDay(
  businessDate: string,
  events: readonly AttendanceEventRecord[],
): { open: boolean; hasPunch: boolean; flagged: boolean } {
  const effective = resolveEffectiveEvents(
    events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
      correctionAction: event.correctionAction,
      correctsEventId: event.correctsEventId,
      recordedAt: new Date(event.recordedAt),
    })),
  );
  const summary = summarizeWorkDay(
    businessDate,
    effective.map((event) => ({ eventType: event.eventType, occurredAt: event.occurredAt })),
  );

  return {
    open: summary.state === 'working' || summary.state === 'on_break',
    hasPunch: effective.length > 0,
    // 修正の入った日は、あとから見直したくなる。締めは止めない。
    flagged: events.some((event) => event.correctionAction !== null),
  };
}

/** from から to までの業務日。 */
function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = from; date <= to; date = addDaysToBusinessDate(date, 1)) days.push(date);
  return days;
}
