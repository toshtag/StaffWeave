import { createHash } from 'node:crypto';
import type {
  AttendanceEventRecord,
  WorkCategoryRecord,
  WorkDay,
  WorkScheduleRecord,
} from '@staffweave/contracts';
import type {
  BusinessDate,
  CalculationInput,
  CalculationRules,
  CorrectableEvent,
  WorkCategorySettings,
  WorkSchedule,
} from '@staffweave/domain';
import {
  calculateWorkDay,
  closingPeriodOf,
  dailyRequestAllowsEditing,
  fingerprintSource,
  instantFromLocal,
  monthlyClosingAllowsEditing,
  resolveEffectiveEvents,
  summarizeWorkDay,
} from '@staffweave/domain';
import type { ApprovalRepository } from '../approval/repository.js';
import type { RequestRepository } from '../request/repository.js';
import type { ScheduleRepository } from '../schedule/repository.js';
import type { WorkCategoryRepository } from '../schedule/work-category-repository.js';
import type { CalculationRepository } from './calculation-repository.js';
import type { AttendanceRepository } from './repository.js';

export interface DayRepositories {
  attendance: AttendanceRepository;
  schedule: ScheduleRepository;
  calculations: CalculationRepository;
  approval: ApprovalRepository;
  /** 承認しきった申請を、計算の入力として読むために要る。 */
  requests: RequestRepository;
  /**
   * 勤務予定が指す勤務区分を、対象日に効いている版として読むために要る。
   *
   * 固定休憩・自動休憩・深夜帯の上書き・中抜けの扱いは勤務区分にしか無い。
   * ここを外すと、設定した値が計算へ届かないまま結果だけが出る。
   */
  categories: WorkCategoryRepository;
}

function toCorrectable(record: AttendanceEventRecord): CorrectableEvent {
  return {
    id: record.id,
    eventType: record.eventType,
    occurredAt: new Date(record.occurredAt),
    correctionAction: record.correctionAction,
    correctsEventId: record.correctsEventId,
    recordedAt: new Date(record.recordedAt),
  };
}

/** 予定の「現地 0 時からの分数」を絶対時刻へ直す。 */
function toDomainSchedule(
  schedule: WorkScheduleRecord | null,
  businessDate: BusinessDate,
  timeZone: string,
): WorkSchedule | null {
  if (schedule === null) return null;
  return {
    dayType: schedule.dayType,
    startAt:
      schedule.startMinutes === null
        ? null
        : instantFromLocal(businessDate, schedule.startMinutes, timeZone),
    endAt:
      schedule.endMinutes === null
        ? null
        : instantFromLocal(businessDate, schedule.endMinutes, timeZone),
    breakMinutes: schedule.breakMinutes,
  };
}

/**
 * 勤務区分の版から、計算が使う値だけを取り出す。
 *
 * 所定時刻・日種別・表示のための値はここへ入れない。それらは勤務予定側で
 * 解決済みで、両方から渡すと同じ意味の値が 2 つになる。
 * 優先順位は docs/product/work-category-precedence.md にある。
 */
function toDomainCategory(category: WorkCategoryRecord | null): WorkCategorySettings | null {
  if (category === null) return null;
  return {
    code: category.code,
    fixedBreaks: category.fixedBreaks,
    autoBreaks: category.autoBreaks,
    nightStartMinutes: category.nightStartMinutes,
    nightEndMinutes: category.nightEndMinutes,
    gapTreatment: category.gapTreatment,
    deemedMinutes: category.deemedMinutes,
  };
}

function fingerprintOf(input: CalculationInput): string {
  return createHash('sha256').update(fingerprintSource(input), 'utf8').digest('hex');
}

interface DayContext {
  calculationInput: CalculationInput;
  day: Omit<WorkDay, 'calculation'>;
}

async function buildContext(
  repositories: DayRepositories,
  workspaceId: string,
  employeeId: string,
  businessDate: BusinessDate,
  timeZone: string,
  knownRules?: CalculationRules,
): Promise<DayContext> {
  // トランザクション内では 1 つの接続を共有するため、問い合わせは並列にせず順に行う。
  const history = await repositories.attendance.listEventsForDay(
    workspaceId,
    employeeId,
    businessDate,
  );
  const schedule = await repositories.schedule.findWorkSchedule(
    workspaceId,
    employeeId,
    businessDate,
  );
  // 勤務予定が勤務区分を指していれば、対象日に効いている版を読む。
  // 指していなければ、これまでどおり勤務予定の所定時刻と休憩分数だけで計算する。
  const category =
    schedule?.workCategoryId == null
      ? null
      : await repositories.categories.findWorkCategoryForDate(
          workspaceId,
          schedule.workCategoryId,
          businessDate,
        );
  const rules =
    knownRules ?? (await repositories.schedule.findCalculationRules(workspaceId, businessDate));
  const request = await repositories.approval.findRequest(workspaceId, employeeId, businessDate);
  const closing = await repositories.approval.findClosing(
    workspaceId,
    employeeId,
    closingPeriodOf(businessDate),
  );
  // 承認しきった申請だけを読む。途中の段では計算を動かさない。
  const approvals = await repositories.requests.findApprovedAdjustments(
    workspaceId,
    employeeId,
    businessDate,
  );

  const byId = new Map(history.map((record) => [record.id, record]));
  const effective = resolveEffectiveEvents(history.map(toCorrectable));
  const effectiveEvents = effective
    .map((event) => byId.get(event.id))
    .filter((record): record is AttendanceEventRecord => record !== undefined);

  const events = effective.map((event) => ({
    eventType: event.eventType,
    occurredAt: event.occurredAt,
  }));
  const summary = summarizeWorkDay(businessDate, events);

  return {
    calculationInput: {
      businessDate,
      timeZone,
      events,
      schedule: toDomainSchedule(schedule, businessDate, timeZone),
      rules,
      category: toDomainCategory(category),
      approvals,
    },
    day: {
      businessDate,
      employeeId,
      timeZone,
      state: summary.state,
      firstClockInAt: summary.firstClockInAt?.toISOString() ?? null,
      lastClockOutAt: summary.lastClockOutAt?.toISOString() ?? null,
      sessions: summary.sessions.map((session) => ({
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
      })),
      breaks: summary.breaks.map((period) => ({
        startedAt: period.startedAt.toISOString(),
        endedAt: period.endedAt?.toISOString() ?? null,
      })),
      events: effectiveEvents,
      history,
      schedule,
      request,
      closing,
      editable:
        (request === null || dailyRequestAllowsEditing(request.state)) &&
        (closing === null || monthlyClosingAllowsEditing(closing.state)),
    },
  };
}

/** 保存済みの計算結果を添えて一日分を読み出す。計算はやり直さない。 */
export async function loadWorkDay(
  repositories: DayRepositories,
  workspaceId: string,
  employeeId: string,
  businessDate: BusinessDate,
  timeZone: string,
): Promise<WorkDay> {
  const context = await buildContext(repositories, workspaceId, employeeId, businessDate, timeZone);
  const calculation = await repositories.calculations.findLatest(
    workspaceId,
    employeeId,
    businessDate,
  );
  return { ...context.day, calculation };
}

/**
 * 計算をやり直し、入力が前回と変わっていれば新しい版として保存する。
 * 打刻・修正・予定の変更のたびに呼ぶ。
 *
 * `rules` は、複数の日をまとめて計算し直す呼び出し（勤務予定の生成）のために開ける。
 * ワークスペース単位の設定であり、日ごとに読み直しても同じ値になる。
 */
export async function recalculateWorkDay(
  repositories: DayRepositories,
  workspaceId: string,
  employeeId: string,
  businessDate: BusinessDate,
  timeZone: string,
  rules?: CalculationRules,
): Promise<WorkDay> {
  const context = await buildContext(
    repositories,
    workspaceId,
    employeeId,
    businessDate,
    timeZone,
    rules,
  );

  const fingerprint = fingerprintOf(context.calculationInput);
  const latest = await repositories.calculations.findLatest(workspaceId, employeeId, businessDate);

  if (latest !== null && latest.inputFingerprint === fingerprint) {
    return { ...context.day, calculation: latest };
  }

  const result = calculateWorkDay(context.calculationInput);
  const calculation = await repositories.calculations.insert(workspaceId, {
    employeeId,
    businessDate,
    version: (latest?.version ?? 0) + 1,
    inputFingerprint: fingerprint,
    result,
  });

  return { ...context.day, calculation };
}
