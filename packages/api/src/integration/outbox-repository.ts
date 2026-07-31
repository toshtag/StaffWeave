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
  /** 送信先。登録が止められている場合は null。 */
  endpoint: { url: string; secretHash: string } | null;
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
  url: string | null;
  secret_hash: string | null;
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
                      outbox.event_id, outbox.payload, outbox.occurred_at, outbox.claim_token
         )
         SELECT claimed.*, endpoints.url, endpoints.secret_hash, endpoints.active
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
        endpoint:
          row.active === true && row.url !== null && row.secret_hash !== null
            ? { url: row.url, secretHash: row.secret_hash }
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
  };
}
