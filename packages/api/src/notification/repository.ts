import type { NotificationKind, NotificationRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';

/**
 * 利用者への通知の読み書き。
 *
 * 積むのは業務処理と同じトランザクションの中で行う。
 * 別に積むと、巻き戻した処理の通知だけが残る。
 */
export interface NotificationRepository {
  /**
   * その従業員の申請を決裁できる利用者。
   *
   * ワークスペース全体を見られる利用者と、その従業員の組織を範囲に持つ利用者。
   * 段ごとの担当者は持たないため、決裁できる相手すべてへ知らせる。
   */
  listApprovers(workspaceId: string, employeeId: string): Promise<string[]>;

  /** 従業員に紐づく利用者。紐づいていなければ null。 */
  findUserForEmployee(workspaceId: string, employeeId: string): Promise<string | null>;

  /**
   * 通知を積む。同じ鍵の二度目は何もしない。
   *
   * 二度目を失敗にすると、決裁そのものが通らなくなる。
   * 通知の重複は業務を止める理由にならない。
   */
  enqueue(workspaceId: string, input: NewNotification): Promise<void>;

  list(
    workspaceId: string,
    userId: string,
    query: { unreadOnly: boolean; limit: number },
  ): Promise<NotificationRecord[]>;

  /** 自分あての通知を既読にする。他人の通知は動かない。 */
  markRead(workspaceId: string, userId: string, ids: readonly string[]): Promise<number>;

  countUnread(workspaceId: string, userId: string): Promise<number>;
}

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  subjectType: 'employee_request';
  subjectId: string | null;
  summary: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
  dedupeKey: string;
}

interface Row {
  id: string;
  kind: NotificationKind;
  subject_type: NotificationRecord['subjectType'];
  subject_id: string | null;
  summary: string;
  detail: Record<string, unknown>;
  occurred_at: Date;
  read_at: Date | null;
}

const COLUMNS = 'id, kind, subject_type, subject_id, summary, detail, occurred_at, read_at';

function toRecord(row: Row): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    summary: row.summary,
    detail: row.detail,
    occurredAt: row.occurred_at.toISOString(),
    readAt: row.read_at === null ? null : row.read_at.toISOString(),
  };
}

export function createNotificationRepository(db: Queryable): NotificationRepository {
  return {
    async listApprovers(workspaceId, employeeId) {
      const rows = await db.query<{ user_id: string }>(
        `SELECT DISTINCT roles.user_id
           FROM user_roles AS roles
           JOIN employees AS employee
             ON employee.workspace_id = roles.workspace_id AND employee.id = $2
           LEFT JOIN user_organization_scopes AS scopes
             ON scopes.workspace_id = roles.workspace_id
            AND scopes.user_id = roles.user_id
            AND scopes.organization_id = employee.organization_id
          WHERE roles.workspace_id = $1
            AND (
              roles.role = 'workspace_admin'
              OR (roles.role = 'organization_manager' AND scopes.user_id IS NOT NULL)
            )`,
        [workspaceId, employeeId],
      );
      return rows.map((row) => row.user_id);
    },

    async findUserForEmployee(workspaceId, employeeId) {
      const rows = await db.query<{ user_id: string | null }>(
        'SELECT user_id FROM employees WHERE workspace_id = $1 AND id = $2',
        [workspaceId, employeeId],
      );
      return rows[0]?.user_id ?? null;
    },

    async enqueue(workspaceId, input) {
      await db.query(
        `INSERT INTO notifications
           (workspace_id, user_id, kind, subject_type, subject_id, summary, detail,
            occurred_at, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (workspace_id, user_id, dedupe_key) DO NOTHING`,
        [
          workspaceId,
          input.userId,
          input.kind,
          input.subjectType,
          input.subjectId,
          input.summary,
          JSON.stringify(input.detail),
          input.occurredAt,
          input.dedupeKey,
        ],
      );
    },

    async list(workspaceId, userId, query) {
      const rows = await db.query<Row>(
        `SELECT ${COLUMNS} FROM notifications
          WHERE workspace_id = $1 AND user_id = $2
            AND ($3::boolean = false OR read_at IS NULL)
          ORDER BY occurred_at DESC, id
          LIMIT $4`,
        [workspaceId, userId, query.unreadOnly, query.limit],
      );
      return rows.map(toRecord);
    },

    async markRead(workspaceId, userId, ids) {
      if (ids.length === 0) return 0;
      const rows = await db.query<{ id: string }>(
        `UPDATE notifications SET read_at = now()
          WHERE workspace_id = $1 AND user_id = $2 AND id = ANY($3::uuid[])
            AND read_at IS NULL
        RETURNING id`,
        [workspaceId, userId, ids as string[]],
      );
      return rows.length;
    },

    async countUnread(workspaceId, userId) {
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
          WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [workspaceId, userId],
      );
      return Number(rows[0]?.count ?? '0');
    },
  };
}
