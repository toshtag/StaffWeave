-- 日次申請・承認と月次締め。
--
-- 現在の状態は 1 行で持ち、そこへ至った経緯は追記のみの遷移履歴として残す。
-- 「今どうなっているか」と「どうしてそうなったか」を両方たどれるようにする。

CREATE TABLE daily_attendance_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id         uuid        NOT NULL,
  business_date       date        NOT NULL,
  state               text        NOT NULL DEFAULT 'draft',
  -- 状態機械が持つ付随情報（提出回数・差し戻し回数）。
  submissions         integer     NOT NULL DEFAULT 0,
  returns             integer     NOT NULL DEFAULT 0,
  submitted_at        timestamptz,
  decided_at          timestamptz,
  decided_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_attendance_requests_state_values
    CHECK (state IN ('draft', 'submitted', 'approved', 'returned', 'cancelled')),
  CONSTRAINT daily_attendance_requests_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT daily_attendance_requests_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT daily_attendance_requests_decider_fkey
    FOREIGN KEY (decided_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX daily_attendance_requests_employee_date_key
  ON daily_attendance_requests (workspace_id, employee_id, business_date);

CREATE INDEX daily_attendance_requests_state_idx
  ON daily_attendance_requests (workspace_id, state, business_date);

CREATE TABLE attendance_request_transitions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id     uuid        NOT NULL,
  from_state     text        NOT NULL,
  to_state       text        NOT NULL,
  event          text        NOT NULL,
  actor_user_id  uuid,
  comment        text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_request_transitions_comment_length
    CHECK (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 1000),
  CONSTRAINT attendance_request_transitions_request_fkey
    FOREIGN KEY (request_id, workspace_id)
    REFERENCES daily_attendance_requests (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT attendance_request_transitions_actor_fkey
    FOREIGN KEY (actor_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE INDEX attendance_request_transitions_request_idx
  ON attendance_request_transitions (workspace_id, request_id, occurred_at);

CREATE TRIGGER attendance_request_transitions_append_only
  BEFORE UPDATE OR DELETE ON attendance_request_transitions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE monthly_closings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id         uuid        NOT NULL,
  -- 締め期間はその月の 1 日で表す。
  period              date        NOT NULL,
  state               text        NOT NULL DEFAULT 'open',
  reopens             integer     NOT NULL DEFAULT 0,
  closed_at           timestamptz,
  closed_by_user_id   uuid,
  reopened_at         timestamptz,
  reopened_by_user_id uuid,
  reopen_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_closings_state_values CHECK (state IN ('open', 'closed')),
  CONSTRAINT monthly_closings_period_is_first_day CHECK (date_part('day', period) = 1),
  CONSTRAINT monthly_closings_reason_length
    CHECK (reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 2 AND 500),
  CONSTRAINT monthly_closings_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT monthly_closings_closer_fkey
    FOREIGN KEY (closed_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT monthly_closings_reopener_fkey
    FOREIGN KEY (reopened_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX monthly_closings_employee_period_key
  ON monthly_closings (workspace_id, employee_id, period);
