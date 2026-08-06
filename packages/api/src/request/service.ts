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
  buildLeaveBalance,
  hasPermission,
  validateLeaveConsumption,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import type { LeaveRepository } from '../leave/repository.js';
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest, notFound } from '../shared/errors.js';
import type { NotificationOutbox } from '../shared/notification-outbox.js';
import type { RequestRepository } from './repository.js';

export interface RequestRepositories {
  requests: RequestRepository;
  leave: LeaveRepository;
  audit: AuditRepository;
  outbox: NotificationOutbox;
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
   * 承認しきった休暇の申請を、台帳へ反映する。
   *
   * 同じ申請から二度消化しないことは DB の一意制約で担保する。
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

    // 時間帯の指定があればその長さ、なければ 1 日ぶんを引く。
    // 1 日ぶんの分数は休暇種別の設定から取る。決まっていなければ引く量を決められない。
    const minutes =
      request.startMinutes !== null && request.endMinutes !== null
        ? request.endMinutes - request.startMinutes
        : leaveType.dayMinutes;
    if (minutes === null) {
      throw new ApiError(
        'conflict',
        `休暇種別 ${leaveType.code} の 1 日ぶんの分数が設定されていないため、台帳へ反映できません`,
      );
    }

    const entries = await repositories.leave.listEntries(workspaceId, {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
    });
    const problems = validateLeaveConsumption({
      balance: buildLeaveBalance(entries, request.businessDate),
      minutes,
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
      await repositories.leave.addEntry(workspaceId, {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        entryType: 'consume',
        minutes: -minutes,
        effectiveOn: request.businessDate,
        requestId: request.id,
        createdByUserId: actorUserId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError('conflict', 'この申請はすでに台帳へ反映されています');
      }
      throw error;
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

      return deps.transaction(async ({ requests, audit }) => {
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
        return created;
      });
    },

    async decide(context, requestId, input) {
      if (input.decision === 'returned' && (input.comment ?? '').trim().length === 0) {
        throw invalidRequest([{ field: 'comment', message: '差し戻しの理由を入力してください' }]);
      }

      return deps.transaction(async (repositories) => {
        const { requests, audit, outbox } = repositories;
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

        // 承認しきった休暇の申請だけを台帳へ反映する。途中の段では動かさない。
        const type = await requests.findRequestType(context.workspace.id, saved.requestTypeId);
        if (saved.state === 'approved' && type?.category === 'leave') {
          await consumeLeave(repositories, context.workspace.id, saved, context.user.id);
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
          },
        });

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
      return deps.transaction(async ({ requests, audit }) => {
        const existing = await requests.findRequest(context.workspace.id, requestId);
        if (!existing) throw notFound('申請');
        await requireSubmittableFor(context, existing.employeeId);

        const type = await requests.findRequestType(context.workspace.id, existing.requestTypeId);
        if (!type) throw notFound('申請種別');

        const next = applyStagedRequestEvent(stateOf(existing), { type: 'RESUBMIT' });
        if (!next.ok) throw new ApiError('conflict', PROBLEM_MESSAGES[next.problem]);

        // 出し直しに合わせて内容も直せる。要否は、提出時と同じ定義で見る。
        await requests.updateRequestContent(context.workspace.id, existing.id, input);
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
        return saved;
      });
    },

    async cancel(context, requestId) {
      return deps.transaction(async ({ requests, audit }) => {
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
        return saved;
      });
    },
  };
}
