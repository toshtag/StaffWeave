import type {
  CreateRequestTypeRequest,
  DecideEmployeeRequestRequest,
  EmployeeRequestRecord,
  RequestTypeRecord,
  ResubmitEmployeeRequestRequest,
  SubmitEmployeeRequestRequest,
  UpdateRequestTypeRequest,
} from '@staffweave/contracts';
import type { StagedRequest, StagedRequestProblem } from '@staffweave/domain';
import {
  applyStagedRequestEvent,
  closingPeriodOf,
  hasPermission,
  instantFromLocal,
  resolveEffectiveEvents,
  validateLeaveConsumptions,
} from '@staffweave/domain';
import type { DayRepositories } from '../attendance/day.js';
import { recalculateWorkDay } from '../attendance/day.js';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import type { LeaveRepository } from '../leave/repository.js';
import type { NotificationRepository } from '../notification/repository.js';
import { notifyRequestEvent } from '../notification/service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest, notFound } from '../shared/errors.js';
import type { NotificationOutbox } from '../shared/notification-outbox.js';
import type { RequestRepository } from './repository.js';

export interface RequestRepositories extends DayRepositories {
  requests: RequestRepository;
  leave: LeaveRepository;
  audit: AuditRepository;
  outbox: NotificationOutbox;
  /** 利用者への通知。外部への配送とは別に、正本を DB へ残す。 */
  notifications: NotificationRepository;
}

export interface RequestServiceDependencies {
  repository: RequestRepository;
  visibility: EmployeeVisibilityGuard;
  now: () => Date;
  transaction<T>(fn: (repositories: RequestRepositories) => Promise<T>): Promise<T>;
}

export interface RequestService {
  listTypes(context: AuthenticatedContext): Promise<RequestTypeRecord[]>;
  createType(
    context: AuthenticatedContext,
    input: CreateRequestTypeRequest,
  ): Promise<RequestTypeRecord>;
  updateType(
    context: AuthenticatedContext,
    requestTypeId: string,
    input: UpdateRequestTypeRequest,
  ): Promise<RequestTypeRecord>;

  list(
    context: AuthenticatedContext,
    query: {
      employeeId?: string;
      state?: EmployeeRequestRecord['state'];
      from?: string;
      to?: string;
    },
  ): Promise<EmployeeRequestRecord[]>;
  submit(
    context: AuthenticatedContext,
    input: SubmitEmployeeRequestRequest,
  ): Promise<EmployeeRequestRecord>;
  decide(
    context: AuthenticatedContext,
    requestId: string,
    input: DecideEmployeeRequestRequest,
  ): Promise<EmployeeRequestRecord>;
  resubmit(
    context: AuthenticatedContext,
    requestId: string,
    input: ResubmitEmployeeRequestRequest,
  ): Promise<EmployeeRequestRecord>;
  cancel(context: AuthenticatedContext, requestId: string): Promise<EmployeeRequestRecord>;
}

/**
 * 承認しきったときに日次の勤怠へ効く区分。
 *
 * 休暇はここに入れない。休暇は台帳へ消化として反映し、
 * 日次の計算は勤務予定の日種別から出す。
 */
const REFLECTED_CATEGORIES: readonly RequestTypeRecord['category'][] = [
  'overtime',
  'holiday_work',
  'attendance_correction',
];

/** 進められない理由を、利用者に伝わる言葉へ直す。 */
const PROBLEM_MESSAGES: Record<StagedRequestProblem, string> = {
  not_pending: 'この申請はいま決裁を待っていません',
  step_mismatch: 'この段はすでに決裁済みです。画面を読み込み直してください',
  submission_mismatch: 'この申請は出し直されています。画面を読み込み直してください',
  not_returned: '差し戻された申請だけを出し直せます',
  already_decided: 'この申請はすでに決着しています',
};

function stateOf(record: EmployeeRequestRecord): StagedRequest {
  return {
    state: record.state,
    totalSteps: record.totalSteps,
    currentStep: record.currentStep,
    submissions: record.submissions,
  };
}

/** 申請の対象期間。閲覧範囲の判断に使う。 */
function periodOf(record: EmployeeRequestRecord): { from: string; to: string } {
  return { from: record.businessDate, to: record.endsOn ?? record.businessDate };
}

/**
 * 休暇として引かない日の種別。
 *
 * 予定が「働かない日」と言っている日は、休暇を取るまでもなく休みになる。
 * ここを引くと、申請した本人が使っていない残数まで減る。
 */
const NON_WORKING_DAY_TYPES = new Set(['non_working_day', 'legal_holiday', 'public_holiday']);

export function createRequestService(deps: RequestServiceDependencies): RequestService {
  const requireTypeManager = (context: AuthenticatedContext): void => {
    if (!hasPermission(context.roles, 'request.manage')) throw forbidden();
  };

  /** 申請を出せる相手。自分か、従業員を代理で扱える利用者だけ。 */
  const requireSubmittableFor = async (
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<void> => {
    if (employeeId === context.employee?.id) return;
    if (!hasPermission(context.roles, 'employee.read')) throw forbidden();
    await deps.visibility.requireVisibleEmployee(context, employeeId);
  };

  /** 入力の過不足を、申請種別の定義に照らして見る。 */
  const validateContent = (
    type: RequestTypeRecord,
    content: {
      leaveTypeId?: string | null;
      startMinutes?: number | null;
      endMinutes?: number | null;
      overtimeLimitMinutes?: number | null;
      reason?: string | null;
    },
  ): void => {
    const problems = [];
    if (type.requiresReason && (content.reason ?? '').trim().length === 0) {
      problems.push({ field: 'reason', message: '理由を入力してください' });
    }
    if (type.requiresLeaveType && !content.leaveTypeId) {
      problems.push({ field: 'leaveTypeId', message: '休暇種別を選んでください' });
    }
    if (
      type.requiresTimeRange &&
      (content.startMinutes === null ||
        content.startMinutes === undefined ||
        content.endMinutes === null ||
        content.endMinutes === undefined)
    ) {
      problems.push({ field: 'startMinutes', message: '時間帯を入力してください' });
    }
    if (
      type.requiresOvertimeLimit &&
      (content.overtimeLimitMinutes === null || content.overtimeLimitMinutes === undefined)
    ) {
      problems.push({ field: 'overtimeLimitMinutes', message: '上限の時刻を入力してください' });
    }
    if (problems.length > 0) throw invalidRequest(problems);
  };

  /**
   * 休暇を消化する日を決める。
   *
   * 申請は `endsOn` で期間を表せる。その全ての日から、勤務予定が
   * 「働かない日」と言っている日を除く。休みの日を休暇として引くと、
   * 申請した本人が使っていない残数まで減る。
   *
   * 予定が置かれていない日は除かない。予定が無いことは「休みである」
   * ことを意味しない。決まっていない日を勝手に休みへ寄せると、
   * 引くべき残数が引かれないまま承認が通る。
   */
  const leaveDatesOf = async (
    repositories: RequestRepositories,
    workspaceId: string,
    request: EmployeeRequestRecord,
  ): Promise<string[]> => {
    const dates = await repositories.requests.listAffectedDates(workspaceId, request.id);
    const schedules = await repositories.schedule.listWorkSchedules(
      workspaceId,
      request.employeeId,
      dates[0] ?? request.businessDate,
      dates.at(-1) ?? request.businessDate,
    );
    const nonWorking = new Set(
      schedules
        .filter((schedule) => NON_WORKING_DAY_TYPES.has(schedule.dayType))
        .map((schedule) => schedule.businessDate),
    );
    return dates.filter((date) => !nonWorking.has(date));
  };

  /**
   * 承認しきった休暇の申請を、台帳へ反映する。
   *
   * 対象の日数ぶんをまとめて確かめ、まとめて積む。1 日ずつ確かめて
   * 1 日ずつ積むと、途中で足りなくなったときに前の日ぶんだけが引かれた
   * 状態が残る。申請は 1 つなのに反映は途中まで、という状態を作らない。
   *
   * 同じ申請の同じ日から二度消化しないことは DB の一意制約で担保する。
   * ここで先に読んで判断しても、同時に届いた承認は擦り抜ける。
   */
  const consumeLeave = async (
    repositories: RequestRepositories,
    workspaceId: string,
    request: EmployeeRequestRecord,
    actorUserId: string,
  ): Promise<void> => {
    if (request.leaveTypeId === null) return;

    const leaveType = await repositories.leave.findLeaveType(workspaceId, request.leaveTypeId);
    if (!leaveType) throw notFound('休暇種別');

    const timed = request.startMinutes !== null && request.endMinutes !== null;

    // 時間帯を指定した申請は 1 日ぶんだけにする。
    // 「9:00–12:00 を 3 日ぶん」は、日ごとに同じ時間帯を取るという意味にも、
    // 期間の始まりと終わりの時刻という意味にも読める。決めずに受け取らない。
    if (timed && request.endsOn !== null && request.endsOn !== request.businessDate) {
      throw new ApiError('conflict', '時間帯を指定した休暇の申請は 1 日ぶんだけを対象にできます');
    }

    // 時間帯の指定があればその長さ、なければ 1 日ぶんを引く。
    // 1 日ぶんの分数は休暇種別の設定から取る。決まっていなければ引く量を決められない。
    const minutes =
      timed && request.startMinutes !== null && request.endMinutes !== null
        ? request.endMinutes - request.startMinutes
        : leaveType.dayMinutes;
    if (minutes === null) {
      throw new ApiError(
        'conflict',
        `休暇種別 ${leaveType.code} の 1 日ぶんの分数が設定されていないため、台帳へ反映できません`,
      );
    }

    const dates = await leaveDatesOf(repositories, workspaceId, request);
    if (dates.length === 0) return;

    // 残数を読んでから積むまでの間に、別の申請の承認が割り込めないようにする。
    // 割り込まれると、どちらの承認も「足りている」と判断して合計が負になる。
    await repositories.leave.lockLedgerOf(workspaceId, request.employeeId);

    const entries = await repositories.leave.listEntries(workspaceId, {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
    });
    const consumptions = dates.map((effectiveOn) => ({ minutes, effectiveOn }));
    const problems = validateLeaveConsumptions({
      entries,
      consumptions,
      unitMinutes: leaveType.unitMinutes,
    });
    if (problems.includes('insufficient')) {
      throw new ApiError('conflict', '休暇の残数が足りないため、承認できません');
    }
    if (problems.includes('not_a_multiple')) {
      throw new ApiError(
        'conflict',
        `この休暇は ${leaveType.unitMinutes} 分単位でしか取得できません`,
      );
    }

    try {
      for (const consumption of consumptions) {
        await repositories.leave.addEntry(workspaceId, {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          entryType: 'consume',
          minutes: -consumption.minutes,
          effectiveOn: consumption.effectiveOn,
          requestId: request.id,
          createdByUserId: actorUserId,
        });
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError('conflict', 'この申請はすでに台帳へ反映されています');
      }
      throw error;
    }
  };

  /**
   * 承認しきった申請を、日次の勤怠へ反映する。
   *
   * 反映するのは 3 つの区分だけ。休暇は台帳の側で扱う。
   *
   * 締め済みの期間に当たる日があれば、承認そのものを断る。
   * 黙って承認すると、承認したのに計算が動かない日ができ、
   * 「承認済み」と「給与へ渡した値」が食い違ったまま残る。
   *
   * 断るのは締め済みだけで、日次の申請が承認済みの日は断らない。
   * 承認済みの日を直すためにこの申請があり、これも承認を通っている。
   * ここで断ると、確定した日を直す手段が締め解除しか無くなる。
   * 画面から直に修正する経路（`requireEditableDay`）は、これまでどおり断る。
   */
  const applyToAttendance = async (
    repositories: RequestRepositories,
    workspaceId: string,
    request: EmployeeRequestRecord,
    type: RequestTypeRecord,
    actorUserId: string,
  ): Promise<string[]> => {
    const dates = await repositories.requests.listAffectedDates(workspaceId, request.id);
    if (dates.length === 0) return [];

    const timeZone = await repositories.attendance.findTimeZoneForEmployee(
      workspaceId,
      request.employeeId,
    );
    if (timeZone === null) throw notFound('従業員');

    for (const businessDate of dates) {
      const closing = await repositories.approval.findClosing(
        workspaceId,
        request.employeeId,
        closingPeriodOf(businessDate),
      );
      if (closing?.state === 'closed') {
        throw new ApiError(
          'conflict',
          `${businessDate} は締め済みの期間です。締めを解除してから承認してください`,
        );
      }
    }

    if (type.category === 'attendance_correction') {
      await rewritePunches(repositories, workspaceId, request, timeZone, actorUserId);
    }

    for (const businessDate of dates) {
      await recalculateWorkDay(
        repositories,
        workspaceId,
        request.employeeId,
        businessDate,
        timeZone,
      );
    }
    return dates;
  };

  /**
   * 承認しきった打刻修正の申請を、実際の打刻として積む。
   *
   * 元の打刻は書き換えない。効いている出勤・退勤を取り消す記録を積み、
   * そのうえで申請した時刻を追加する。あとから「誰がいつ何を直したか」を辿れる。
   *
   * 休憩の打刻は触らない。申請が持つのは出退勤の時間帯だけで、
   * 休憩まで消すと、申請に書いていない記録が承認によって消える。
   */
  const rewritePunches = async (
    repositories: RequestRepositories,
    workspaceId: string,
    request: EmployeeRequestRecord,
    timeZone: string,
    actorUserId: string,
  ): Promise<void> => {
    if (request.startMinutes === null || request.endMinutes === null) return;
    if (request.endsOn !== null && request.endsOn !== request.businessDate) {
      throw new ApiError(
        'conflict',
        '打刻修正の申請は 1 日ぶんだけを対象にできます。期間の申請は反映できません',
      );
    }

    const { attendance } = repositories;
    if (!(await attendance.lockEmployee(workspaceId, request.employeeId))) {
      throw notFound('従業員');
    }

    const businessDate = request.businessDate;
    const reason = (request.reason ?? '').trim() || '承認された打刻修正の申請による';

    const history = await attendance.listEventsForDay(
      workspaceId,
      request.employeeId,
      businessDate,
    );
    const byId = new Map(history.map((record) => [record.id, record]));
    const effective = resolveEffectiveEvents(
      history.map((record) => ({
        id: record.id,
        eventType: record.eventType,
        occurredAt: new Date(record.occurredAt),
        correctionAction: record.correctionAction,
        correctsEventId: record.correctsEventId,
        recordedAt: new Date(record.recordedAt),
      })),
    );

    let index = 0;
    for (const event of effective) {
      if (event.eventType !== 'clock_in' && event.eventType !== 'clock_out') continue;
      const target = byId.get(event.id);
      if (target === undefined) continue;
      await attendance.insertEvent(workspaceId, {
        employeeId: request.employeeId,
        eventType: target.eventType,
        occurredAt: new Date(target.occurredAt),
        businessDate,
        source: 'correction',
        // 同じ申請から二度積まないよう、鍵は申請の識別子から決める。
        requestId: `employee-request:${request.id}:void:${index}`,
        recordedByUserId: actorUserId,
        correctsEventId: target.id,
        correctionAction: 'void',
        correctionReason: reason,
      });
      index += 1;
    }

    for (const [eventType, minutes, suffix] of [
      ['clock_in', request.startMinutes, 'in'],
      ['clock_out', request.endMinutes, 'out'],
    ] as const) {
      await attendance.insertEvent(workspaceId, {
        employeeId: request.employeeId,
        eventType,
        occurredAt: instantFromLocal(businessDate, minutes, timeZone),
        businessDate,
        source: 'correction',
        requestId: `employee-request:${request.id}:${suffix}`,
        recordedByUserId: actorUserId,
        correctionAction: 'add',
        correctionReason: reason,
      });
    }
  };

  return {
    async listTypes(context) {
      return deps.repository.listRequestTypes(context.workspace.id);
    },

    async createType(context, input) {
      requireTypeManager(context);
      return deps.transaction(async ({ requests, audit }) => {
        let created: RequestTypeRecord;
        try {
          created = await requests.createRequestType(context.workspace.id, input);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ApiError('conflict', `申請種別 ${input.code} はすでにあります`);
          }
          throw error;
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'request_type.created',
          targetType: 'request_type',
          targetId: created.id,
          summary: `申請種別 ${created.code} を作りました`,
          detail: { code: created.code, category: created.category, steps: created.approvalSteps },
        });
        return created;
      });
    },

    async updateType(context, requestTypeId, input) {
      requireTypeManager(context);
      return deps.transaction(async ({ requests, audit }) => {
        const updated = await requests.updateRequestType(
          context.workspace.id,
          requestTypeId,
          input,
        );
        if (!updated) throw notFound('申請種別');

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'request_type.updated',
          targetType: 'request_type',
          targetId: updated.id,
          // 提出済みの申請の段数は動かない。ここで変わるのは、これから出す申請だけ。
          summary: `申請種別 ${updated.code} の定義を変えました（提出済みの申請の段数は変わりません）`,
          detail: { ...input },
        });
        return updated;
      });
    },

    async list(context, query) {
      const requests = await deps.repository.listRequests(context.workspace.id, query);
      return deps.visibility.filterVisible(
        context,
        requests,
        (request) => request.employeeId,
        periodOf,
      );
    },

    async submit(context, input) {
      await requireSubmittableFor(context, input.employeeId);

      return deps.transaction(async ({ requests, audit, notifications }) => {
        const type = await requests.findRequestType(context.workspace.id, input.requestTypeId);
        if (!type) throw notFound('申請種別');
        if (!type.active) {
          throw new ApiError('conflict', `申請種別 ${type.code} はいま使えません`);
        }
        validateContent(type, input);

        let created: EmployeeRequestRecord;
        try {
          created = await requests.insertRequest(context.workspace.id, {
            requestTypeId: type.id,
            employeeId: input.employeeId,
            // 段数は、いまの定義から写す。あとで定義が変わっても、この申請では動かない。
            totalSteps: type.approvalSteps,
            businessDate: input.businessDate,
            endsOn: input.endsOn ?? null,
            leaveTypeId: input.leaveTypeId ?? null,
            startMinutes: input.startMinutes ?? null,
            endMinutes: input.endMinutes ?? null,
            overtimeLimitMinutes: input.overtimeLimitMinutes ?? null,
            reason: input.reason ?? null,
          });
        } catch (error) {
          if (isForeignKeyViolation(error)) throw notFound('従業員か休暇種別');
          throw error;
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'employee_request.submitted',
          targetType: 'employee_request',
          targetId: created.id,
          summary: `${created.businessDate} の${type.name}を申請しました`,
          detail: {
            employeeId: created.employeeId,
            requestTypeId: type.id,
            totalSteps: created.totalSteps,
          },
        });

        await notifyRequestEvent(notifications, context.workspace.id, {
          event: { type: 'submitted' },
          request: created,
          typeName: type.name,
          occurredAt: deps.now(),
          actorUserId: context.user.id,
        });
        return created;
      });
    },

    async decide(context, requestId, input) {
      if (input.decision === 'returned' && (input.comment ?? '').trim().length === 0) {
        throw invalidRequest([{ field: 'comment', message: '差し戻しの理由を入力してください' }]);
      }

      return deps.transaction(async (repositories) => {
        const { requests, audit, outbox, notifications } = repositories;
        const existing = await requests.findRequest(context.workspace.id, requestId);
        if (!existing) throw notFound('申請');

        if (!hasPermission(context.roles, 'attendance.approve')) throw forbidden();
        if (existing.employeeId === context.employee?.id) {
          throw new ApiError('forbidden', '自分の申請は自分で承認・差し戻しできません');
        }
        await deps.visibility.requireVisibleEmployee(
          context,
          existing.employeeId,
          periodOf(existing),
        );

        const next = applyStagedRequestEvent(stateOf(existing), {
          type: input.decision === 'approved' ? 'APPROVE' : 'RETURN',
          step: input.step,
          submission: input.submission,
        });
        if (!next.ok) throw new ApiError('conflict', PROBLEM_MESSAGES[next.problem]);

        // 決裁はまず台帳へ積む。同じ段の再送はここの一意制約で止まる。
        try {
          await requests.addApproval(context.workspace.id, {
            requestId: existing.id,
            step: input.step,
            submission: input.submission,
            decision: input.decision,
            decidedByUserId: context.user.id,
            onBehalfOfUserId: input.onBehalfOfUserId ?? null,
            comment: input.comment ?? null,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ApiError('conflict', PROBLEM_MESSAGES.step_mismatch);
          }
          throw error;
        }

        const now = deps.now();
        const decided = next.request.state === 'submitted' ? null : now;
        const saved = await requests.updateRequestState(context.workspace.id, existing.id, {
          state: next.request.state,
          currentStep: next.request.currentStep,
          submissions: next.request.submissions,
          decidedAt: decided,
        });
        if (!saved) throw notFound('申請');

        // 承認しきった申請だけを反映する。途中の段では動かさない。
        const type = await requests.findRequestType(context.workspace.id, saved.requestTypeId);
        let affectedDates: string[] = [];
        if (saved.state === 'approved' && type !== null) {
          if (type.category === 'leave') {
            await consumeLeave(repositories, context.workspace.id, saved, context.user.id);
          }
          if (REFLECTED_CATEGORIES.includes(type.category)) {
            affectedDates = await applyToAttendance(
              repositories,
              context.workspace.id,
              saved,
              type,
              context.user.id,
            );
          }
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: `employee_request.${input.decision}`,
          targetType: 'employee_request',
          targetId: saved.id,
          summary: `${saved.businessDate} の申請の ${input.step} 段目を${
            input.decision === 'approved' ? '承認' : '差し戻し'
          }しました`,
          detail: {
            employeeId: saved.employeeId,
            step: input.step,
            submission: input.submission,
            fromState: existing.state,
            toState: saved.state,
            onBehalfOfUserId: input.onBehalfOfUserId ?? null,
            comment: input.comment ?? null,
            // どの日の計算をやり直したか。承認と計算の対応をあとから辿れるようにする。
            recalculatedDates: affectedDates,
          },
        });

        if (type !== null && (saved.state === 'approved' || saved.state === 'returned')) {
          await notifyRequestEvent(notifications, context.workspace.id, {
            event: { type: saved.state === 'approved' ? 'approved' : 'returned' },
            request: saved,
            typeName: type.name,
            occurredAt: now,
            actorUserId: context.user.id,
          });
        }
        if (type !== null && input.onBehalfOfUserId !== undefined) {
          await notifyRequestEvent(notifications, context.workspace.id, {
            event: { type: 'decided_on_behalf', onBehalfOfUserId: input.onBehalfOfUserId },
            request: saved,
            typeName: type.name,
            occurredAt: now,
            actorUserId: context.user.id,
          });
        }

        if (saved.state === 'approved' || saved.state === 'returned') {
          await outbox.enqueue(context.workspace.id, {
            eventType:
              saved.state === 'approved'
                ? 'attendance_request.approved'
                : 'attendance_request.returned',
            payload: {
              requestId: saved.id,
              employeeId: saved.employeeId,
              businessDate: saved.businessDate,
              state: saved.state,
            },
            occurredAt: now,
          });
        }

        return saved;
      });
    },

    async resubmit(context, requestId, input) {
      return deps.transaction(async ({ requests, audit, notifications }) => {
        const existing = await requests.findRequest(context.workspace.id, requestId);
        if (!existing) throw notFound('申請');
        await requireSubmittableFor(context, existing.employeeId);

        const type = await requests.findRequestType(context.workspace.id, existing.requestTypeId);
        if (!type) throw notFound('申請種別');

        const next = applyStagedRequestEvent(stateOf(existing), { type: 'RESUBMIT' });
        if (!next.ok) throw new ApiError('conflict', PROBLEM_MESSAGES[next.problem]);

        // 出し直しに合わせて内容も直せる。要否は、いまの申請の定義で見る。
        // 触れなかった項目は前の提出のままなので、両方を重ねてから判断する。
        validateContent(type, {
          leaveTypeId: 'leaveTypeId' in input ? input.leaveTypeId : existing.leaveTypeId,
          startMinutes: 'startMinutes' in input ? input.startMinutes : existing.startMinutes,
          endMinutes: 'endMinutes' in input ? input.endMinutes : existing.endMinutes,
          overtimeLimitMinutes:
            'overtimeLimitMinutes' in input
              ? input.overtimeLimitMinutes
              : existing.overtimeLimitMinutes,
          reason: 'reason' in input ? input.reason : existing.reason,
        });
        await requests.updateRequestContent(context.workspace.id, existing.id, input);

        const saved = await requests.updateRequestState(context.workspace.id, existing.id, {
          state: next.request.state,
          currentStep: next.request.currentStep,
          submissions: next.request.submissions,
          decidedAt: null,
          submittedAt: deps.now(),
        });
        if (!saved) throw notFound('申請');

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'employee_request.resubmitted',
          targetType: 'employee_request',
          targetId: saved.id,
          summary: `${saved.businessDate} の申請を出し直しました（${saved.submissions} 回目）`,
          detail: { employeeId: saved.employeeId, submissions: saved.submissions },
        });

        // 出し直しは新しい提出。もう一度 1 段目の承認者へ知らせる。
        await notifyRequestEvent(notifications, context.workspace.id, {
          event: { type: 'submitted' },
          request: saved,
          typeName: type.name,
          occurredAt: deps.now(),
          actorUserId: context.user.id,
        });
        return saved;
      });
    },

    async cancel(context, requestId) {
      return deps.transaction(async ({ requests, audit, notifications }) => {
        const existing = await requests.findRequest(context.workspace.id, requestId);
        if (!existing) throw notFound('申請');
        // 取り下げは本人だけが行える。
        if (existing.employeeId !== context.employee?.id) throw forbidden();

        const next = applyStagedRequestEvent(stateOf(existing), { type: 'CANCEL' });
        if (!next.ok) throw new ApiError('conflict', PROBLEM_MESSAGES[next.problem]);

        const saved = await requests.updateRequestState(context.workspace.id, existing.id, {
          state: next.request.state,
          currentStep: next.request.currentStep,
          submissions: next.request.submissions,
          decidedAt: deps.now(),
        });
        if (!saved) throw notFound('申請');

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'employee_request.cancelled',
          targetType: 'employee_request',
          targetId: saved.id,
          summary: `${saved.businessDate} の申請を取り下げました`,
          detail: { employeeId: saved.employeeId, fromState: existing.state },
        });

        // 取り下げは、決裁を待っていた相手へ知らせる。
        const type = await requests.findRequestType(context.workspace.id, saved.requestTypeId);
        if (type !== null) {
          const approvers = await notifications.listApprovers(
            context.workspace.id,
            saved.employeeId,
          );
          for (const userId of approvers) {
            if (userId === context.user.id) continue;
            await notifications.enqueue(context.workspace.id, {
              userId,
              kind: 'request_cancelled',
              subjectType: 'employee_request',
              subjectId: saved.id,
              summary: `${saved.businessDate} の${type.name}が取り下げられました`,
              detail: { requestId: saved.id, employeeId: saved.employeeId },
              occurredAt: deps.now(),
              dedupeKey: `${saved.id}:${saved.submissions}:cancelled`,
            });
          }
        }
        return saved;
      });
    },
  };
}
