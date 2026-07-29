-- 打刻イベントと監査記録。
--
-- どちらも追記のみ（append-only）とし、UPDATE と DELETE をトリガーで拒否する。
-- 取り消しや修正は、元の行を書き換えず新しい行として表現する。

CREATE OR REPLACE FUNCTION reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% は追記のみのテーブルです。変更や削除はできません。', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE attendance_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id         uuid        NOT NULL,
  event_type          text        NOT NULL,
  -- 打刻が起きた時刻。端末やブラウザが観測した瞬間。
  occurred_at         timestamptz NOT NULL,
  -- サーバーが受け取った時刻。オフライン再送では occurred_at より遅くなる。
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  -- この打刻が属する業務日。拠点のタイムゾーンと業務日開始時刻から決まる。
  business_date       date        NOT NULL,
  source              text        NOT NULL,
  -- 二重送信を防ぐための冪等キー。送信側が生成する。
  request_id          text        NOT NULL,
  recorded_by_user_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_events_type_values
    CHECK (event_type IN ('clock_in', 'clock_out')),
  CONSTRAINT attendance_events_source_values
    CHECK (source IN ('web', 'mobile', 'device', 'correction')),
  CONSTRAINT attendance_events_request_id_length
    CHECK (char_length(request_id) BETWEEN 8 AND 128),
  CONSTRAINT attendance_events_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT attendance_events_user_fkey
    FOREIGN KEY (recorded_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 同じ冪等キーの再送は 1 行だけを残す。
CREATE UNIQUE INDEX attendance_events_request_key
  ON attendance_events (workspace_id, employee_id, request_id);

CREATE INDEX attendance_events_day_idx
  ON attendance_events (workspace_id, employee_id, business_date, occurred_at);

CREATE TRIGGER attendance_events_append_only
  BEFORE UPDATE OR DELETE ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- 誰が行ったか。端末やシステムによる操作もあるため利用者は任意。
  actor_kind    text        NOT NULL,
  actor_user_id uuid,
  action        text        NOT NULL,
  target_type   text        NOT NULL,
  target_id     uuid,
  -- 画面へそのまま出せる日本語の要約。
  summary       text        NOT NULL,
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_logs_actor_kind_values CHECK (actor_kind IN ('user', 'device', 'system')),
  CONSTRAINT audit_logs_user_fkey
    FOREIGN KEY (actor_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE INDEX audit_logs_workspace_time_idx ON audit_logs (workspace_id, occurred_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (workspace_id, target_type, target_id);

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
