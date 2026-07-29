-- 勤務予定と勤怠計算。
--
-- 時刻は「現地 0 時からの分数」で持つ。絶対時刻で保存すると、
-- 拠点のタイムゾーン設定を直したときに過去の予定まで動いてしまうため。
-- 日をまたぐ勤務では終業が 1440 分を超える（例: 翌 7:00 は 1860）。

CREATE TABLE work_patterns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code          text        NOT NULL,
  name          text        NOT NULL,
  start_minutes integer     NOT NULL,
  end_minutes   integer     NOT NULL,
  break_minutes integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_patterns_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT work_patterns_start_range CHECK (start_minutes BETWEEN 0 AND 1439),
  CONSTRAINT work_patterns_end_range CHECK (end_minutes BETWEEN 1 AND 2879),
  CONSTRAINT work_patterns_order CHECK (end_minutes > start_minutes),
  CONSTRAINT work_patterns_break_range CHECK (break_minutes BETWEEN 0 AND 1439),
  CONSTRAINT work_patterns_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX work_patterns_workspace_code_key ON work_patterns (workspace_id, code);

CREATE TABLE work_schedules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL,
  business_date   date        NOT NULL,
  work_pattern_id uuid,
  day_type        text        NOT NULL DEFAULT 'working_day',
  start_minutes   integer,
  end_minutes     integer,
  break_minutes   integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_schedules_day_type_values
    CHECK (day_type IN ('working_day', 'non_working_day', 'public_holiday')),
  CONSTRAINT work_schedules_time_pair
    CHECK ((start_minutes IS NULL) = (end_minutes IS NULL)),
  CONSTRAINT work_schedules_order
    CHECK (start_minutes IS NULL OR end_minutes > start_minutes),
  CONSTRAINT work_schedules_break_range CHECK (break_minutes BETWEEN 0 AND 1439),
  CONSTRAINT work_schedules_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_schedules_pattern_fkey
    FOREIGN KEY (work_pattern_id, workspace_id)
    REFERENCES work_patterns (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX work_schedules_employee_date_key
  ON work_schedules (workspace_id, employee_id, business_date);

-- 計算ルール。版を上げるたびに過去の計算結果と突き合わせられるよう、
-- 計算結果側にも版と根拠を保存する。
CREATE TABLE calculation_rule_sets (
  workspace_id        uuid        PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  version             text        NOT NULL DEFAULT 'v1',
  night_start_minutes integer     NOT NULL DEFAULT 1320,
  night_end_minutes   integer     NOT NULL DEFAULT 300,
  rounding_minutes    integer     NOT NULL DEFAULT 0,
  rounding_mode       text        NOT NULL DEFAULT 'none',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calculation_rule_sets_night_start CHECK (night_start_minutes BETWEEN 0 AND 1439),
  CONSTRAINT calculation_rule_sets_night_end CHECK (night_end_minutes BETWEEN 0 AND 1439),
  CONSTRAINT calculation_rule_sets_rounding CHECK (rounding_minutes BETWEEN 0 AND 60),
  CONSTRAINT calculation_rule_sets_rounding_mode
    CHECK (rounding_mode IN ('none', 'down', 'nearest'))
);

-- 計算結果。入力が変わるたびに版を増やして追記し、過去の計算をたどれるようにする。
CREATE TABLE attendance_calculations (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id               uuid        NOT NULL,
  business_date             date        NOT NULL,
  version                   integer     NOT NULL,
  calculated_at             timestamptz NOT NULL DEFAULT now(),
  -- 計算に使った入力の指紋。同じ入力なら新しい版を作らない。
  input_fingerprint         text        NOT NULL,
  rule_version              text        NOT NULL,
  attended_minutes          integer     NOT NULL,
  worked_minutes            integer     NOT NULL,
  break_minutes             integer     NOT NULL,
  scheduled_minutes         integer     NOT NULL,
  within_schedule_minutes   integer     NOT NULL,
  outside_schedule_minutes  integer     NOT NULL,
  night_minutes             integer     NOT NULL,
  non_working_day_minutes   integer     NOT NULL,
  basis                     jsonb       NOT NULL,
  CONSTRAINT attendance_calculations_version_positive CHECK (version >= 1),
  CONSTRAINT attendance_calculations_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX attendance_calculations_version_key
  ON attendance_calculations (workspace_id, employee_id, business_date, version);

CREATE INDEX attendance_calculations_day_idx
  ON attendance_calculations (workspace_id, employee_id, business_date, version DESC);

CREATE TRIGGER attendance_calculations_append_only
  BEFORE UPDATE OR DELETE ON attendance_calculations
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
