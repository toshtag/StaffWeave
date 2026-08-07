/**
 * 保持期間を過ぎた記録の削除。
 *
 * これまでの手順は、生の SQL の `DELETE` の例を示した直後に「消した記録も
 * 監査へ残してください」と求めていた。示した SQL は監査を残さないため、
 * 手順のとおりに実行しても要件を満たせない。
 *
 * ここでは 2 つを一緒にする。何をどれだけ消すかを先に出し、消したことを
 * 同じトランザクションで監査へ残す。分けると、消した記録だけが残らない。
 *
 * 保持する期間は事業者が決める。製品は既定値を持たない。
 * 渡されなければ、その対象は消さない。
 */

import type { Queryable } from '@staffweave/db';
import type { AuditRepository } from '../audit/repository.js';

/** 消す対象。表と、日付として見る列だけを持つ。 */
export interface RetentionTarget {
  /** 手順や引数で指す名前。 */
  name: string;
  table: string;
  /** 保持期間を測る列。 */
  column: string;
  /**
   * ワークスペースごとに分かれているか。
   *
   * ログインの失敗は、どのワークスペースの利用者かが分かる前に記録される。
   * 分かれていない表をワークスペースごとに消そうとすると、条件そのものを
   * 書けない。
   */
  scope: 'workspace' | 'global';
}

/**
 * 消せる対象。
 *
 * ここに無い表は消せない。表の名前を引数から自由に受け取ると、
 * 打刻や計算のような消してはいけない表まで対象にできてしまう。
 */
export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  {
    name: 'webhook-deliveries',
    table: 'webhook_deliveries',
    column: 'attempted_at',
    scope: 'workspace',
  },
  {
    name: 'attendance-locations',
    table: 'attendance_event_locations',
    column: 'captured_at',
    scope: 'workspace',
  },
  {
    name: 'login-attempts',
    table: 'login_attempts',
    column: 'updated_at',
    scope: 'global',
  },
];

export interface RetentionPlanRow {
  name: string;
  table: string;
  /** この日より前の記録を消す。 */
  before: string;
  count: number;
}

export interface RetentionOutcome {
  workspaceId: string;
  /** 実際に消したか。事前確認では false。 */
  applied: boolean;
  rows: RetentionPlanRow[];
}

export interface RetentionRepositories {
  db: Queryable;
  audit: AuditRepository;
}

export interface RetentionRequest {
  workspaceId: string;
  /** 対象ごとの保持日数。渡されなかった対象は消さない。 */
  days: ReadonlyMap<string, number>;
  /** 事前確認なら false。 */
  apply: boolean;
  now: Date;
}

function targetOf(name: string): RetentionTarget {
  const target = RETENTION_TARGETS.find((candidate) => candidate.name === name);
  if (target === undefined) throw new Error(`消せない対象です: ${name}`);
  return target;
}

function boundaryOf(now: Date, days: number): string {
  const boundary = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return boundary.toISOString();
}

/**
 * 消す件数を数える。実際には消さない。
 *
 * 事前確認と実行で同じ境界を使う。別々に数えると、間に時計が進んで
 * 「確かめた件数」と「消した件数」が食い違う。
 */
export async function planRetention(
  repositories: RetentionRepositories,
  request: RetentionRequest,
): Promise<RetentionPlanRow[]> {
  const rows: RetentionPlanRow[] = [];
  for (const [name, days] of request.days) {
    const target = targetOf(name);
    const before = boundaryOf(request.now, days);
    const counted =
      target.scope === 'workspace'
        ? await repositories.db.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${target.table}
              WHERE workspace_id = $1 AND ${target.column} < $2::timestamptz`,
            [request.workspaceId, before],
          )
        : await repositories.db.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${target.table}
              WHERE ${target.column} < $1::timestamptz`,
            [before],
          );
    rows.push({
      name,
      table: target.table,
      before,
      count: Number(counted[0]?.count ?? '0'),
    });
  }
  return rows;
}

/**
 * 保持期間を過ぎた記録を消す。
 *
 * 事前確認では 1 行も消さない。消す場合も、消した件数を同じ
 * トランザクションで監査へ残す。分けると、消した記録だけが残らない。
 *
 * 同じ引数で二度呼んでも、二度目は 0 件になる。境界より前の記録が
 * すでに無いためで、やり直しても壊れない。
 */
export async function runRetention(
  repositories: RetentionRepositories,
  request: RetentionRequest,
): Promise<RetentionOutcome> {
  const planned = await planRetention(repositories, request);
  if (!request.apply) {
    return { workspaceId: request.workspaceId, applied: false, rows: planned };
  }

  const rows: RetentionPlanRow[] = [];
  for (const plan of planned) {
    const target = targetOf(plan.name);
    const deleted =
      target.scope === 'workspace'
        ? await repositories.db.query<{ id: string }>(
            `DELETE FROM ${target.table}
              WHERE workspace_id = $1 AND ${target.column} < $2::timestamptz
              RETURNING 1 AS id`,
            [request.workspaceId, plan.before],
          )
        : await repositories.db.query<{ id: string }>(
            `DELETE FROM ${target.table}
              WHERE ${target.column} < $1::timestamptz
              RETURNING 1 AS id`,
            [plan.before],
          );
    rows.push({ ...plan, count: deleted.length });
  }

  await repositories.audit.record(request.workspaceId, {
    actorKind: 'system',
    actorUserId: null,
    action: 'retention.applied',
    targetType: 'workspace',
    targetId: request.workspaceId,
    summary: `保持期間を過ぎた記録を ${rows.reduce((total, row) => total + row.count, 0)} 件消しました`,
    detail: {
      rows: rows.map((row) => ({ name: row.name, before: row.before, count: row.count })),
    },
  });

  return { workspaceId: request.workspaceId, applied: true, rows };
}
