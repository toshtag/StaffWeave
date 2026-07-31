-- Webhook の送信待ち。
--
-- 業務処理と同じトランザクションでこの行を作り、実際の HTTP 送信は別のワーカーが行う。
-- こうすると、コミットされなかった処理を外部へ通知することがなく、
-- 応答しない送信先があっても承認や締めの完了が待たされない。
--
-- 送信した後・完了を記録する前にワーカーが停止すると同じ行がもう一度送られ得るため、
-- 受け取り側は event_id で重複を取り除く。
-- 一方、HTTP エラーやタイムアウトは自動再送しないため、到達は保証しない。

CREATE TABLE webhook_outbox (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  endpoint_id      uuid        NOT NULL,
  event_type       text        NOT NULL,
  -- 出来事の識別子。再処理しても変わらない。受け取り側の重複排除に使う。
  event_id         text        NOT NULL,
  payload          jsonb       NOT NULL,
  -- 業務上の出来事が起きた時刻。通知の本文へ入れる値で、送信の予定は決めない。
  occurred_at      timestamptz NOT NULL,
  -- ワーカーが取り出せるようになる時刻。行を登録した時点とし、occurred_at とは連動させない。
  available_at     timestamptz NOT NULL DEFAULT now(),
  -- 取得中の印。期限を過ぎた取得は他のワーカーが引き取れる。
  -- これらの時刻はワーカー同士の排他に使うため、必ず PostgreSQL の時刻で設定する。
  claimed_at       timestamptz,
  claim_expires_at timestamptz,
  claim_token      uuid,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- 種別は domain の WEBHOOK_EVENT_TYPES と対応する。増やすときはマイグレーションを追加する。
  CONSTRAINT webhook_outbox_event_type_values CHECK (
    event_type IN (
      'attendance_request.approved',
      'attendance_request.returned',
      'monthly_closing.closed',
      'monthly_closing.reopened'
    )
  ),
  CONSTRAINT webhook_outbox_event_id_not_empty CHECK (event_id <> ''),
  -- 取得の印は 3 つまとめて設定し、まとめて外す。
  CONSTRAINT webhook_outbox_claim_consistent CHECK (
    (claimed_at IS NULL) = (claim_token IS NULL)
    AND (claimed_at IS NULL) = (claim_expires_at IS NULL)
  ),
  CONSTRAINT webhook_outbox_endpoint_fkey
    FOREIGN KEY (endpoint_id, workspace_id)
    REFERENCES webhook_endpoints (id, workspace_id) ON DELETE CASCADE,
  -- 同じ出来事を同じ送信先へ二重に積まない。
  CONSTRAINT webhook_outbox_event_key UNIQUE (workspace_id, endpoint_id, event_id)
);

-- ワーカーは未処理の行だけを古い順に走査する。
CREATE INDEX webhook_outbox_pending_idx
  ON webhook_outbox (available_at, created_at)
  WHERE completed_at IS NULL;
