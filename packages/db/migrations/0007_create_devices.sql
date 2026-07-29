-- 打刻端末と、端末から届いた署名イベントの受信記録。
--
-- 端末は登録待ちで作られ、Agent が資格情報を受け取ると有効になる。
-- 受信記録は追記のみとし、連番の欠落や端末時計のずれを後から確認できるようにする。

CREATE TABLE devices (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  site_id               uuid,
  name                  text        NOT NULL,
  state                 text        NOT NULL DEFAULT 'pending',
  enrollments           integer     NOT NULL DEFAULT 0,
  -- 登録用の一度きりのトークン。生の値は保存せずハッシュだけを持つ。
  enrollment_token_hash text,
  -- Agent が生成した鍵の公開部分（SPKI PEM）。秘密鍵はサーバーへ渡らない。
  public_key            text,
  last_sequence         integer     NOT NULL DEFAULT 0,
  enrolled_at           timestamptz,
  revoked_at            timestamptz,
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_state_values CHECK (state IN ('pending', 'active', 'revoked')),
  CONSTRAINT devices_active_needs_key
    CHECK (state <> 'active' OR public_key IS NOT NULL),
  CONSTRAINT devices_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT devices_site_fkey
    FOREIGN KEY (site_id, workspace_id)
    REFERENCES sites (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX devices_enrollment_token_key
  ON devices (enrollment_token_hash)
  WHERE enrollment_token_hash IS NOT NULL;

CREATE INDEX devices_workspace_state_idx ON devices (workspace_id, state);

CREATE TABLE device_event_receipts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  device_id           uuid        NOT NULL,
  sequence            integer     NOT NULL,
  request_id          text        NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  device_time         timestamptz NOT NULL,
  clock_skew_seconds  integer     NOT NULL,
  -- 直前の連番との差。1 なら欠落なし。
  sequence_step       integer     NOT NULL,
  attendance_event_id uuid,
  -- 受理できた場合の業務日。再送へ同じ応答を返すために保持する。
  business_date       date,
  outcome             text        NOT NULL,
  detail              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT device_event_receipts_outcome_values
    CHECK (outcome IN ('accepted', 'duplicate', 'rejected')),
  CONSTRAINT device_event_receipts_device_fkey
    FOREIGN KEY (device_id, workspace_id)
    REFERENCES devices (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT device_event_receipts_attendance_fkey
    FOREIGN KEY (attendance_event_id, workspace_id)
    REFERENCES attendance_events (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX device_event_receipts_request_key
  ON device_event_receipts (workspace_id, device_id, request_id);

CREATE INDEX device_event_receipts_sequence_idx
  ON device_event_receipts (workspace_id, device_id, sequence);

CREATE TRIGGER device_event_receipts_append_only
  BEFORE UPDATE OR DELETE ON device_event_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
