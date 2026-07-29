-- PC セッションの観測。
--
-- ここに入るのは「PC がどう使われていたか」という観測であり、勤務時間そのものではない。
-- 打刻イベントとは別のテーブルに置き、混ざらないようにする。
-- 観測から勤務時間を自動で確定させることはしない。

CREATE TABLE workstation_session_observations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id      uuid        NOT NULL,
  device_id        uuid,
  observation_type text        NOT NULL,
  occurred_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  business_date    date        NOT NULL,
  -- 送信のまとまりを表す冪等キー。まとめて届いた観測は同じ値を持つ。
  request_id       text        NOT NULL,
  workstation_name text,
  detail           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT workstation_session_observations_type_values
    CHECK (observation_type IN ('sign_in', 'sign_out', 'lock', 'unlock')),
  CONSTRAINT workstation_session_observations_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT workstation_session_observations_device_fkey
    FOREIGN KEY (device_id, workspace_id)
    REFERENCES devices (id, workspace_id) ON DELETE SET NULL
);

CREATE INDEX workstation_session_observations_day_idx
  ON workstation_session_observations (workspace_id, employee_id, business_date, occurred_at);

CREATE TRIGGER workstation_session_observations_append_only
  BEFORE UPDATE OR DELETE ON workstation_session_observations
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
