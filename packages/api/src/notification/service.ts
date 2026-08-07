import type { EmployeeRequestRecord, NotificationRecord } from '@staffweave/contracts';
import type { AuthenticatedContext } from '../identity/service.js';
import { invalidRequest } from '../shared/errors.js';
import type { NotificationRepository } from './repository.js';

/**
 * 申請まわりの通知。
 *
 * 通知の正本は DB に置く。外部への配送を足す場合も、正本はここのままにする。
 * 外部だけに置くと、送信に失敗した通知が誰にも見えなくなる。
 *
 * 積むのは業務処理と同じトランザクションの中。別に積むと、
 * 巻き戻した処理の通知だけが残る。
 */

/** 一度に読む上限。溜まった通知をすべて返すと、応答が返らなくなる。 */
export const NOTIFICATION_PAGE_SIZE = 100;

export interface NotificationServiceDependencies {
  repository: NotificationRepository;
}

export interface NotificationService {
  list(
    context: AuthenticatedContext,
    query: { unreadOnly?: boolean },
  ): Promise<{ notifications: NotificationRecord[]; unreadCount: number }>;
  markRead(
    context: AuthenticatedContext,
    ids: readonly string[],
  ): Promise<{ read: number; unreadCount: number }>;
}

export function createNotificationService(
  deps: NotificationServiceDependencies,
): NotificationService {
  return {
    async list(context, query) {
      const notifications = await deps.repository.list(context.workspace.id, context.user.id, {
        unreadOnly: query.unreadOnly ?? false,
        limit: NOTIFICATION_PAGE_SIZE,
      });
      return {
        notifications,
        unreadCount: await deps.repository.countUnread(context.workspace.id, context.user.id),
      };
    },

    async markRead(context, ids) {
      if (ids.length > NOTIFICATION_PAGE_SIZE) {
        throw invalidRequest([
          { field: 'ids', message: `一度に既読にできるのは ${NOTIFICATION_PAGE_SIZE} 件までです` },
        ]);
      }
      // 宛先は自分に固定する。他人の識別子を渡しても、その行は動かない。
      const read = await deps.repository.markRead(context.workspace.id, context.user.id, ids);
      return {
        read,
        unreadCount: await deps.repository.countUnread(context.workspace.id, context.user.id),
      };
    },
  };
}

/** 申請の出来事から、誰へ何を知らせるかを決めて積む。 */
export async function notifyRequestEvent(
  repository: NotificationRepository,
  workspaceId: string,
  input: {
    event:
      | { type: 'submitted' }
      | { type: 'approved' }
      | { type: 'returned' }
      | { type: 'cancelled' }
      | { type: 'decided_on_behalf'; onBehalfOfUserId: string };
    request: EmployeeRequestRecord;
    typeName: string;
    occurredAt: Date;
    /** 出来事を起こした利用者。自分の操作の通知は自分へ送らない。 */
    actorUserId: string;
  },
): Promise<void> {
  const { request, event } = input;
  // 同じ出来事から二度積まない。提出回数と段を鍵へ入れ、
  // 決裁の再送や画面からの二度押しで通知が並ばないようにする。
  const key = `${request.id}:${request.submissions}:${request.currentStep}:${event.type}`;

  if (event.type === 'submitted') {
    const approvers = await repository.listApprovers(workspaceId, request.employeeId);
    for (const userId of approvers) {
      if (userId === input.actorUserId) continue;
      await repository.enqueue(workspaceId, {
        userId,
        kind: 'request_submitted',
        subjectType: 'employee_request',
        subjectId: request.id,
        summary: `${request.businessDate} の${input.typeName}が申請されました`,
        detail: { requestId: request.id, employeeId: request.employeeId },
        occurredAt: input.occurredAt,
        dedupeKey: key,
      });
    }
    return;
  }

  if (event.type === 'decided_on_behalf') {
    await repository.enqueue(workspaceId, {
      userId: event.onBehalfOfUserId,
      kind: 'request_decided_on_behalf',
      subjectType: 'employee_request',
      subjectId: request.id,
      summary: `${request.businessDate} の${input.typeName}が、あなたの代理で決裁されました`,
      detail: { requestId: request.id, decidedByUserId: input.actorUserId },
      occurredAt: input.occurredAt,
      dedupeKey: key,
    });
    return;
  }

  // 承認・差し戻し・取消は、申請した本人へ知らせる。
  const owner = await repository.findUserForEmployee(workspaceId, request.employeeId);
  if (owner === null || owner === input.actorUserId) return;

  const summaries = {
    approved: '承認されました',
    returned: '差し戻されました',
    cancelled: '取り下げられました',
  } as const;

  await repository.enqueue(workspaceId, {
    userId: owner,
    kind: `request_${event.type}` as const,
    subjectType: 'employee_request',
    subjectId: request.id,
    summary: `${request.businessDate} の${input.typeName}が${summaries[event.type]}`,
    detail: { requestId: request.id, state: request.state },
    occurredAt: input.occurredAt,
    dedupeKey: key,
  });
}
