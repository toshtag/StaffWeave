import type { Queryable } from '@staffweave/db';

/**
 * Webhook の送信待ちの永続化。
 *
 * 業務処理と同じトランザクションから `enqueue` を呼び、
 * 送信ワーカーは別の接続から `claimNext` で取り出す。
 *
 * 取り出しは 1 件ずつに限る。まとめて取ると、後ろの行は送信を始める前に占有期限が切れ、
 * まだ手を付けていない行を別のワーカーが引き取って同時送信してしまう。
 * 占有期限が守るのは「送信中の 1 件」だけにする。
 *
 * 取り出し可否と占有期限は、すべて PostgreSQL の時刻で決める。ワーカー同士の排他を
 * 各プロセスの時計に任せると、時計がずれたワーカーが他のワーカーの占有を期限切れと
 * 判断して同じ行を送ってしまう。呼び出し側から基準時刻は渡せないようにする。
 *
 * `claimNext` は Workspace をまたいで走査する。利用者の要求ではなく背景処理であるため、
 * 他の Repository のように `workspaceId` で絞らない。取り出した行は `workspaceId` を保持し、
 * 以後の問い合わせではそれを境界として使う。
 */

export interface WebhookOutboxEntry {
  endpointId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  occurredAt: Date;
}

export interface ClaimedWebhookDelivery {
  id: string;
  workspaceId: string;
  endpointId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  occurredAt: string;
  claimToken: string;
  /** これまでに試した回数。次にいつ送るかを決めるのに使う。 */
  attempts: number;
  /** 送信先。登録が止められている場合は null。 */
  endpoint: { url: string; signingKey: string } | null;
}

export interface ClaimNextInput {
  /** 占有する時間。この時間を過ぎた取得は他のワーカーが引き取れる。 */
  leaseMs: number;
}

export interface WebhookOutboxRepository {
  enqueue(workspaceId: string, entry: WebhookOutboxEntry): Promise<void>;
  /** 送信待ちを 1 件だけ取得する。無ければ null を返す。 */
  claimNext(input: ClaimNextInput): Promise<ClaimedWebhookDelivery | null>;
  /** 取得したワーカーだけが完了させられる。印が一致しなければ false を返す。 */
  complete(id: string, claimToken: string): Promise<boolean>;
  /**
   * 送れなかった行を、あとで送り直せるように戻す。
   * 取得の印を外し、次に取り出せる時刻を先へ動かす。
   */
  scheduleRetry(id: string, claimToken: string, input: RetryInput): Promise<boolean>;
  /**
   * 諦めた印を付ける。行は残す。
   * 消すと、届かなかったこと自体が分からなくなる。
   */
  abandon(id: string, claimToken: string, lastError: string): Promise<boolean>;
  /** 諦めた行を一覧する。人が中身を確かめて送り直すために使う。 */
  listAbandoned(workspaceId: string, limit: number): Promise<AbandonedDelivery[]>;
  /**
   * 諦めた行を、もう一度送信待ちへ戻す。
   * 試行の回数も 0 へ戻す。人が中身を確かめたうえでの操作であるため。
   */
  requeue(workspaceId: string, id: string): Promise<boolean>;
}

export interface RetryInput {
  /** 次に取り出せるようになるまでの時間。 */
  delayMs: number;
  lastError: string;
}

export interface AbandonedDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  eventId: string;
  occurredAt: string;
  attempts: number;
  abandonedAt: string;
  lastError: string | null;
}

interface ClaimedRow {
  id: string;
  workspace_id: string;
  endpoint_id: string;
  event_type: string;
  event_id: string;
  payload: unknown;
  occurred_at: Date;
  claim_token: string;
  attempts: number;
  url: string | null;
  signing_key: string | null;
  active: boolean | null;
}

export function createWebhookOutboxRepository(db: Queryable): WebhookOutboxRepository {
  return {
    async enqueue(workspaceId, entry) {
      // available_at は指定しない。取り出せるようになる時刻は業務上の発生時刻とは別で、
      // 行を登録した時点として DB の既定値に任せる。
      await db.query(
        `INSERT INTO webhook_outbox
           (workspace_id, endpoint_id, event_type, event_id, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          workspaceId,
          entry.endpointId,
          entry.eventType,
          entry.eventId,
          JSON.stringify(entry.payload),
          entry.occurredAt,
        ],
      );
    },

    async claimNext(input) {
      // SKIP LOCKED で、他のワーカーが処理中の行を待たずに次の行へ進む。
      // 時刻はすべて statement_timestamp()。1 つの文の中では同じ値になる。
      const rows = await db.query<ClaimedRow>(
        `WITH candidate AS (
           SELECT id FROM webhook_outbox
            WHERE completed_at IS NULL
              AND abandoned_at IS NULL
              AND available_at <= statement_timestamp()
              AND (claim_expires_at IS NULL OR claim_expires_at <= statement_timestamp())
            ORDER BY available_at, created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         ),
         claimed AS (
           UPDATE webhook_outbox AS outbox
              SET claimed_at = statement_timestamp(),
                  claim_expires_at =
                    statement_timestamp() + ($1::double precision * interval '1 millisecond'),
                  claim_token = gen_random_uuid()
             FROM candidate
            WHERE outbox.id = candidate.id
            RETURNING outbox.id, outbox.workspace_id, outbox.endpoint_id, outbox.event_type,
                      outbox.event_id, outbox.payload, outbox.occurred_at, outbox.claim_token,
                      outbox.attempts
         )
         SELECT claimed.*, endpoints.url, endpoints.signing_key, endpoints.active
           FROM claimed
           LEFT JOIN webhook_endpoints AS endpoints
             ON endpoints.id = claimed.endpoint_id
            AND endpoints.workspace_id = claimed.workspace_id`,
        [input.leaseMs],
      );

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        workspaceId: row.workspace_id,
        endpointId: row.endpoint_id,
        eventType: row.event_type,
        eventId: row.event_id,
        payload: row.payload,
        occurredAt: row.occurred_at.toISOString(),
        claimToken: row.claim_token,
        attempts: row.attempts,
        endpoint:
          row.active === true && row.url !== null && row.signing_key !== null
            ? { url: row.url, signingKey: row.signing_key }
            : null,
      };
    },

    async complete(id, claimToken) {
      // 完了した行に占有の印を残さない。3 列をまとめて外す。
      const rows = await db.query<{ id: string }>(
        `UPDATE webhook_outbox
            SET completed_at = statement_timestamp(),
                claimed_at = NULL, claim_expires_at = NULL, claim_token = NULL
          WHERE id = $1 AND claim_token = $2 AND completed_at IS NULL
          RETURNING id`,
        [id, claimToken],
      );
      return rows.length === 1;
    },

    async scheduleRetry(id, claimToken, input) {
      // 取得の印を外し、次に取り出せる時刻を先へ動かす。
      // 印を残したまま時刻だけ動かすと、期限切れで別のワーカーが先に引き取る。
      const rows = await db.query<{ id: string }>(
        `UPDATE webhook_outbox
            SET attempts = attempts + 1,
                last_error = $3,
                available_at =
                  statement_timestamp() + ($4::double precision * interval '1 millisecond'),
                claimed_at = NULL, claim_expires_at = NULL, claim_token = NULL
          WHERE id = $1 AND claim_token = $2
            AND completed_at IS NULL AND abandoned_at IS NULL
          RETURNING id`,
        [id, claimToken, input.lastError, input.delayMs],
      );
      return rows.length === 1;
    },

    async abandon(id, claimToken, lastError) {
      const rows = await db.query<{ id: string }>(
        `UPDATE webhook_outbox
            SET attempts = attempts + 1,
                abandoned_at = statement_timestamp(),
                last_error = $3,
                claimed_at = NULL, claim_expires_at = NULL, claim_token = NULL
          WHERE id = $1 AND claim_token = $2
            AND completed_at IS NULL AND abandoned_at IS NULL
          RETURNING id`,
        [id, claimToken, lastError],
      );
      return rows.length === 1;
    },

    async listAbandoned(workspaceId, limit) {
      const rows = await db.query<{
        id: string;
        endpoint_id: string;
        event_type: string;
        event_id: string;
        occurred_at: Date;
        attempts: number;
        abandoned_at: Date;
        last_error: string | null;
      }>(
        `SELECT id, endpoint_id, event_type, event_id, occurred_at, attempts,
                abandoned_at, last_error
           FROM webhook_outbox
          WHERE workspace_id = $1 AND abandoned_at IS NOT NULL
          ORDER BY abandoned_at DESC
          LIMIT $2`,
        [workspaceId, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        endpointId: row.endpoint_id,
        eventType: row.event_type,
        eventId: row.event_id,
        occurredAt: row.occurred_at.toISOString(),
        attempts: row.attempts,
        abandonedAt: row.abandoned_at.toISOString(),
        lastError: row.last_error,
      }));
    },

    async requeue(workspaceId, id) {
      const rows = await db.query<{ id: string }>(
        `UPDATE webhook_outbox
            SET abandoned_at = NULL,
                attempts = 0,
                available_at = statement_timestamp(),
                last_error = NULL
          WHERE workspace_id = $1 AND id = $2 AND abandoned_at IS NOT NULL
          RETURNING id`,
        [workspaceId, id],
      );
      return rows.length === 1;
    },
  };
}
