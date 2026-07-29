-- 外部連携。
--
-- API キーは生の値を保存せず、照合できるハッシュだけを持つ。
-- 先頭の識別子だけは平文で保存し、どの鍵が使われたかを画面で見分けられるようにする。
-- Webhook の送信結果は追記のみで残し、届いたかどうかを後から確認できるようにする。

CREATE TABLE api_keys (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name               text        NOT NULL,
  -- 鍵の先頭。利用者が見分けるためだけに使う。
  prefix             text        NOT NULL,
  key_hash           text        NOT NULL,
  scopes             text[]      NOT NULL DEFAULT '{}',
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  CONSTRAINT api_keys_prefix_format CHECK (prefix ~ '^[a-z0-9]{8}$'),
  CONSTRAINT api_keys_scopes_not_empty CHECK (array_length(scopes, 1) >= 1),
  CONSTRAINT api_keys_creator_fkey
    FOREIGN KEY (created_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX api_keys_hash_key ON api_keys (key_hash);
CREATE INDEX api_keys_workspace_idx ON api_keys (workspace_id, revoked_at);

CREATE TABLE webhook_endpoints (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  url          text        NOT NULL,
  -- 署名用の秘密。生の値は作成時にだけ返し、以後はハッシュで照合する。
  secret_hash  text        NOT NULL,
  event_types  text[]      NOT NULL DEFAULT '{}',
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoints_url_scheme CHECK (url ~ '^https?://'),
  CONSTRAINT webhook_endpoints_events_not_empty CHECK (array_length(event_types, 1) >= 1),
  CONSTRAINT webhook_endpoints_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE TABLE webhook_deliveries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  endpoint_id    uuid        NOT NULL,
  event_type     text        NOT NULL,
  event_id       text        NOT NULL,
  payload        jsonb       NOT NULL,
  attempted_at   timestamptz NOT NULL DEFAULT now(),
  status_code    integer,
  outcome        text        NOT NULL,
  error_message  text,
  CONSTRAINT webhook_deliveries_outcome_values
    CHECK (outcome IN ('delivered', 'failed', 'skipped')),
  CONSTRAINT webhook_deliveries_endpoint_fkey
    FOREIGN KEY (endpoint_id, workspace_id)
    REFERENCES webhook_endpoints (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX webhook_deliveries_endpoint_idx
  ON webhook_deliveries (workspace_id, endpoint_id, attempted_at DESC);

CREATE TRIGGER webhook_deliveries_append_only
  BEFORE UPDATE OR DELETE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
