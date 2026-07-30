import type {
  CloseMonthRequest,
  DailyRequestRecord,
  DecideDailyRequestRequest,
  MonthlyClosingRecord,
  ReopenMonthRequest,
  SubmitDailyRequestRequest,
} from '@staffweave/contracts';
import type {
  DailyRequestEventType,
  DailyRequestState,
  WebhookEventType,
} from '@staffweave/domain';
import {
  applyDailyRequestEvent,
  applyMonthlyClosingEvent,
  closingPeriodOf,
  hasPermission,
  INITIAL_DAILY_REQUEST,
  INITIAL_MONTHLY_CLOSING,
  isBusinessDate,
  isDailyRequestState,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest, notFound } from '../shared/errors.js';
import type { ApprovalRepository } from './repository.js';

export interface ApprovalRepositories {
  approval: ApprovalRepository;
  audit: AuditRepository;
}

export interface ApprovalServiceDependencies {
  repository: ApprovalRepository;
  visibility: EmployeeVisibilityGuard;
  /** 承認や締めの結果を外部へ知らせる。失敗しても本体の処理は続ける。 */
  notify: (workspaceId: string, eventType: WebhookEventType, payload: unknown) => Promise<void>;
  now: () => Date;
  transaction<T>(fn: (repositories: ApprovalRepositories) => Promise<T>): Promise<T>;
}

export interface ApprovalService {
  submit(
    context: AuthenticatedContext,
    input: SubmitDailyRequestRequest,
  ): Promise<DailyRequestRecord>;
  decide(
    context: AuthenticatedContext,
    requestId: string,
    event: Extract<DailyRequestEventType, 'APPROVE' | 'RETURN' | 'CANCEL'>,
    input: DecideDailyRequestRequest,
  ): Promise<DailyRequestRecord>;
  listRequests(
    context: AuthenticatedContext,
    query: { employeeId?: string; from: string; to: string; state?: string },
  ): Promise<DailyRequestRecord[]>;
  listClosings(
    context: AuthenticatedContext,
    query: { employeeId?: string; from: string; to: string },
  ): Promise<MonthlyClosingRecord[]>;
  close(context: AuthenticatedContext, input: CloseMonthRequest): Promise<MonthlyClosingRecord>;
  reopen(context: AuthenticatedContext, input: ReopenMonthRequest): Promise<MonthlyClosingRecord>;
}

const STATE_LABELS: Record<DailyRequestState, string> = {
  draft: '下書き',
  submitted: '申請中',
  approved: '承認済み',
  returned: '差し戻し',
  cancelled: '取消済み',
};

function requireEmployee(context: AuthenticatedContext): string {
  if (!context.employee) {
    throw new ApiError('forbidden', 'この利用者には従業員が紐づいていないため、申請できません');
  }
  return context.employee.id;
}

/** 自分以外の従業員を対象にできるのは、閲覧権限を持つ利用者だけ。 */
function resolveTargetEmployeeId(
  context: AuthenticatedContext,
  requested: string | undefined,
): string | undefined {
  if (requested === undefined) {
    if (hasPermission(context.roles, 'employee.read')) return undefined;
    return requireEmployee(context);
  }
  if (requested === context.employee?.id) return requested;
  if (!hasPermission(context.roles, 'employee.read')) throw forbidden();
  return requested;
}

export function createApprovalService(deps: ApprovalServiceDependencies): ApprovalService {
  /**
   * 承認・締めの相手として指定してよいかを、閲覧範囲で判断する。
   * 受入組織側の承認者（外部承認者）もこの仕組みで表す。
   */
  const requireEmployeeInScope = (
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<void> => deps.visibility.requireVisibleEmployee(context, employeeId);

  return {
    async submit(context, input) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      if (!isBusinessDate(input.businessDate)) {
        throw invalidRequest([
          { field: 'businessDate', message: '業務日の形式が正しくありません' },
        ]);
      }

      const period = closingPeriodOf(input.businessDate);

      return deps.transaction(async ({ approval, audit }) => {
        const closing = await approval.findClosing(workspaceId, employeeId, period);
        if (closing?.state === 'closed') {
          throw new ApiError('conflict', 'この月はすでに締められているため、申請できません');
        }

        const existing = await approval.findRequest(workspaceId, employeeId, input.businessDate);
        const current =
          existing === null
            ? INITIAL_DAILY_REQUEST
            : {
                state: existing.state,
                context: { submissions: existing.submissions, returns: existing.returns },
              };

        const next = applyDailyRequestEvent(current, 'SUBMIT');
        if (!next) {
          throw new ApiError('conflict', `${STATE_LABELS[current.state]}の申請は提出できません`);
        }

        const now = deps.now();
        const saved = await approval.saveRequest(workspaceId, {
          employeeId,
          businessDate: input.businessDate,
          state: next.state,
          submissions: next.context.submissions,
          returns: next.context.returns,
          submittedAt: now,
          decidedAt: null,
          decidedByUserId: null,
        });

        await approval.recordTransition(workspaceId, {
          requestId: saved.id,
          fromState: current.state,
          toState: next.state,
          event: 'SUBMIT',
          actorUserId: context.user.id,
          comment: input.comment ?? null,
        });

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'attendance_request.submitted',
          targetType: 'attendance_request',
          targetId: saved.id,
          summary: `${context.employee?.displayName ?? ''} が ${input.businessDate} の勤怠を申請しました`,
          detail: { employeeId, businessDate: input.businessDate, comment: input.comment ?? null },
        });

        return approval.findRequestById(workspaceId, saved.id) as Promise<DailyRequestRecord>;
      });
    },

    async decide(context, requestId, event, input) {
      const workspaceId = context.workspace.id;

      if (event === 'RETURN' && (input.comment ?? '').trim().length === 0) {
        throw invalidRequest([{ field: 'comment', message: '差し戻しの理由を入力してください' }]);
      }

      return deps.transaction(async ({ approval, audit }) => {
        const existing = await approval.findRequestById(workspaceId, requestId);
        if (!existing) throw notFound('申請');

        if (event === 'CANCEL') {
          // 取消は本人だけが行える。
          if (existing.employeeId !== context.employee?.id) throw forbidden();
        } else if (!hasPermission(context.roles, 'attendance.approve')) {
          throw forbidden();
        } else if (existing.employeeId === context.employee?.id) {
          throw new ApiError('forbidden', '自分の申請は自分で承認・差し戻しできません');
        } else {
          await requireEmployeeInScope(context, existing.employeeId);
        }

        const next = applyDailyRequestEvent(
          {
            state: existing.state,
            context: { submissions: existing.submissions, returns: existing.returns },
          },
          event,
        );
        if (!next) {
          throw new ApiError(
            'conflict',
            `${STATE_LABELS[existing.state]}の申請にこの操作はできません`,
          );
        }

        const now = deps.now();
        const saved = await approval.saveRequest(workspaceId, {
          employeeId: existing.employeeId,
          businessDate: existing.businessDate,
          state: next.state,
          submissions: next.context.submissions,
          returns: next.context.returns,
          submittedAt: existing.submittedAt === null ? null : new Date(existing.submittedAt),
          decidedAt: event === 'CANCEL' ? null : now,
          decidedByUserId: event === 'CANCEL' ? null : context.user.id,
        });

        await approval.recordTransition(workspaceId, {
          requestId: saved.id,
          fromState: existing.state,
          toState: next.state,
          event,
          actorUserId: context.user.id,
          comment: input.comment ?? null,
        });

        const actionLabel = event === 'APPROVE' ? '承認' : event === 'RETURN' ? '差し戻し' : '取消';
        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: `attendance_request.${event.toLowerCase()}`,
          targetType: 'attendance_request',
          targetId: saved.id,
          summary: `${existing.businessDate} の勤怠申請を${actionLabel}しました`,
          detail: {
            employeeId: existing.employeeId,
            businessDate: existing.businessDate,
            fromState: existing.state,
            toState: next.state,
            comment: input.comment ?? null,
          },
        });

        const decided = (await approval.findRequestById(
          workspaceId,
          saved.id,
        )) as DailyRequestRecord;

        if (event === 'APPROVE' || event === 'RETURN') {
          await deps.notify(
            workspaceId,
            event === 'APPROVE' ? 'attendance_request.approved' : 'attendance_request.returned',
            {
              requestId: decided.id,
              employeeId: decided.employeeId,
              businessDate: decided.businessDate,
              state: decided.state,
            },
          );
        }

        return decided;
      });
    },

    async listRequests(context, query) {
      const employeeId = resolveTargetEmployeeId(context, query.employeeId);
      if (query.state !== undefined && !isDailyRequestState(query.state)) {
        throw invalidRequest([{ field: 'state', message: '未知の状態です' }]);
      }
      if (employeeId !== undefined) await requireEmployeeInScope(context, employeeId);

      const requests = await deps.repository.listRequests(context.workspace.id, {
        ...(employeeId === undefined ? {} : { employeeId }),
        from: query.from,
        to: query.to,
        ...(query.state === undefined ? {} : { state: query.state as DailyRequestState }),
      });

      return deps.visibility.filterVisible(context, requests, (request) => request.employeeId);
    },

    async listClosings(context, query) {
      const employeeId = resolveTargetEmployeeId(context, query.employeeId);
      if (employeeId !== undefined) await requireEmployeeInScope(context, employeeId);

      const closings = await deps.repository.listClosings(context.workspace.id, {
        ...(employeeId === undefined ? {} : { employeeId }),
        from: query.from,
        to: query.to,
      });

      return deps.visibility.filterVisible(context, closings, (closing) => closing.employeeId);
    },

    async close(context, input) {
      if (!hasPermission(context.roles, 'attendance.close')) throw forbidden();
      await requireEmployeeInScope(context, input.employeeId);
      const workspaceId = context.workspace.id;

      return deps.transaction(async ({ approval, audit }) => {
        const existing = await approval.findClosing(workspaceId, input.employeeId, input.period);
        const current =
          existing === null
            ? INITIAL_MONTHLY_CLOSING
            : { state: existing.state, context: { reopens: existing.reopens } };

        const next = applyMonthlyClosingEvent(current, 'CLOSE');
        if (!next) throw new ApiError('conflict', 'この月はすでに締められています');

        const unapproved = await approval.countUnapprovedDays(
          workspaceId,
          input.employeeId,
          input.period,
        );
        if (unapproved > 0) {
          throw new ApiError(
            'conflict',
            `承認されていない勤務日が ${unapproved} 日あるため締められません`,
          );
        }

        const saved = await approval.saveClosing(workspaceId, {
          employeeId: input.employeeId,
          period: input.period,
          state: next.state,
          reopens: next.context.reopens,
          closedAt: deps.now(),
          closedByUserId: context.user.id,
          reopenedAt: existing?.reopenedAt === undefined ? null : null,
          reopenedByUserId: null,
          reopenReason: null,
        });

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'monthly_closing.closed',
          targetType: 'monthly_closing',
          targetId: null,
          summary: `${input.period} の勤怠を締めました`,
          detail: { employeeId: input.employeeId, period: input.period },
        });

        await deps.notify(workspaceId, 'monthly_closing.closed', {
          employeeId: input.employeeId,
          period: input.period,
        });

        return saved;
      });
    },

    async reopen(context, input) {
      if (!hasPermission(context.roles, 'attendance.close')) throw forbidden();
      await requireEmployeeInScope(context, input.employeeId);
      const workspaceId = context.workspace.id;

      if (input.reason.trim().length < 2) {
        throw invalidRequest([{ field: 'reason', message: '解除の理由を入力してください' }]);
      }

      return deps.transaction(async ({ approval, audit }) => {
        const existing = await approval.findClosing(workspaceId, input.employeeId, input.period);
        if (!existing) throw notFound('締め');

        const next = applyMonthlyClosingEvent(
          { state: existing.state, context: { reopens: existing.reopens } },
          'REOPEN',
        );
        if (!next) throw new ApiError('conflict', 'この月は締められていません');

        const now = deps.now();
        const saved = await approval.saveClosing(workspaceId, {
          employeeId: input.employeeId,
          period: input.period,
          state: next.state,
          reopens: next.context.reopens,
          closedAt: existing.closedAt === null ? null : new Date(existing.closedAt),
          closedByUserId: existing.closedByUserId,
          reopenedAt: now,
          reopenedByUserId: context.user.id,
          reopenReason: input.reason.trim(),
        });

        // 締めを解除したら、承認済みの日次申請も編集できる状態へ戻す。
        const reopened = await approval.reopenApprovedRequests(
          workspaceId,
          input.employeeId,
          input.period,
        );
        for (const request of reopened) {
          await approval.recordTransition(workspaceId, {
            requestId: request.id,
            fromState: 'approved',
            toState: 'returned',
            event: 'REOPEN',
            actorUserId: context.user.id,
            comment: input.reason.trim(),
          });
        }

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'monthly_closing.reopened',
          targetType: 'monthly_closing',
          targetId: null,
          summary: `${input.period} の締めを解除しました`,
          detail: {
            employeeId: input.employeeId,
            period: input.period,
            reason: input.reason.trim(),
            reopenedRequests: reopened.length,
          },
        });

        await deps.notify(workspaceId, 'monthly_closing.reopened', {
          employeeId: input.employeeId,
          period: input.period,
          reason: input.reason.trim(),
        });

        return saved;
      });
    },
  };
}
