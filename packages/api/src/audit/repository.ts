import type { Queryable } from '@staffweave/db';

/**
 * 監査記録。
 * 追記のみで、後から書き換えられない前提で使う（テーブル側でも UPDATE/DELETE を拒否している）。
 */

export type ActorKind = 'user' | 'device' | 'system';

export interface AuditEntry {
  actorKind: ActorKind;
  actorUserId: string | null;
  /** `attendance_event.recorded` のような機械可読な操作名。 */
  action: string;
  targetType: string;
  targetId: string | null;
  /** 画面へそのまま出せる日本語の要約。 */
  summary: string;
  detail?: Record<string, unknown>;
}

export interface AuditRecord extends AuditEntry {
  id: string;
  occurredAt: string;
}

export interface AuditRepository {
  record(workspaceId: string, entry: AuditEntry): Promise<void>;
  listRecent(workspaceId: string, limit: number): Promise<AuditRecord[]>;
}

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_kind: ActorKind;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

export function createAuditRepository(db: Queryable): AuditRepository {
  return {
    async record(workspaceId, entry) {
      await db.query(
        `INSERT INTO audit_logs
           (workspace_id, actor_kind, actor_user_id, action, target_type, target_id, summary, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          workspaceId,
          entry.actorKind,
          entry.actorUserId,
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.summary,
          JSON.stringify(entry.detail ?? {}),
        ],
      );
    },

    async listRecent(workspaceId, limit) {
      const rows = await db.query<AuditRow>(
        `SELECT id, occurred_at, actor_kind, actor_user_id, action, target_type, target_id,
                summary, detail
           FROM audit_logs
          WHERE workspace_id = $1
          ORDER BY occurred_at DESC, id DESC
          LIMIT $2`,
        [workspaceId, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        actorKind: row.actor_kind,
        actorUserId: row.actor_user_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        summary: row.summary,
        detail: row.detail,
      }));
    },
  };
}
