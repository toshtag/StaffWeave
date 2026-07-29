-- 柔軟な勤務制度。
--
-- 週 5 日勤務や曜日固定を前提にしない。
-- 長さの決まった並びを繰り返す「勤務周期」で表し、週休 3 日も 2 勤 2 休も同じ仕組みで扱う。
-- 設定には有効期間を持たせ、途中で制度が変わっても過去の予定を書き換えずに済むようにする。

CREATE TABLE leave_types (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code         text        NOT NULL,
  name         text        NOT NULL,
  -- 賃金の扱いは事業者ごとに異なるため、判断材料として持つだけにする。
  paid         boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_types_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT leave_types_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX leave_types_workspace_code_key ON leave_types (workspace_id, code);

CREATE TABLE work_cycles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code         text        NOT NULL,
  name         text        NOT NULL,
  -- 周期の長さ（日数）。7 なら週単位、4 なら 2 勤 2 休のような回し方になる。
  cycle_length integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_cycles_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT work_cycles_length_range CHECK (cycle_length BETWEEN 1 AND 366),
  CONSTRAINT work_cycles_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX work_cycles_workspace_code_key ON work_cycles (workspace_id, code);

CREATE TABLE work_cycle_days (
  workspace_id    uuid    NOT NULL,
  work_cycle_id   uuid    NOT NULL,
  position        integer NOT NULL,
  day_type        text    NOT NULL DEFAULT 'working_day',
  work_pattern_id uuid,
  PRIMARY KEY (work_cycle_id, position),
  CONSTRAINT work_cycle_days_position_range CHECK (position >= 0),
  CONSTRAINT work_cycle_days_day_type_values
    CHECK (day_type IN ('working_day', 'non_working_day', 'public_holiday')),
  CONSTRAINT work_cycle_days_working_needs_pattern
    CHECK (day_type <> 'working_day' OR work_pattern_id IS NOT NULL),
  CONSTRAINT work_cycle_days_cycle_fkey
    FOREIGN KEY (work_cycle_id, workspace_id)
    REFERENCES work_cycles (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_cycle_days_pattern_fkey
    FOREIGN KEY (work_pattern_id, workspace_id)
    REFERENCES work_patterns (id, workspace_id) ON DELETE RESTRICT
);

-- 従業員への勤務周期の割当。有効期間を持たせ、制度の変更を過去へ波及させない。
CREATE TABLE employee_work_cycles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id    uuid        NOT NULL,
  work_cycle_id  uuid        NOT NULL,
  -- 周期の位置 0 に対応する業務日。
  anchor_date    date        NOT NULL,
  effective_from date        NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_work_cycles_period CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_work_cycles_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employee_work_cycles_cycle_fkey
    FOREIGN KEY (work_cycle_id, workspace_id)
    REFERENCES work_cycles (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX employee_work_cycles_lookup_idx
  ON employee_work_cycles (workspace_id, employee_id, effective_from);

-- 勤務予定に休暇と欠勤を表せるようにする。
ALTER TABLE work_schedules DROP CONSTRAINT work_schedules_day_type_values;
ALTER TABLE work_schedules ADD CONSTRAINT work_schedules_day_type_values
  CHECK (day_type IN ('working_day', 'non_working_day', 'public_holiday', 'leave', 'absence'));

ALTER TABLE work_schedules ADD COLUMN leave_type_id uuid;
ALTER TABLE work_schedules ADD CONSTRAINT work_schedules_leave_type_fkey
  FOREIGN KEY (leave_type_id, workspace_id)
  REFERENCES leave_types (id, workspace_id) ON DELETE SET NULL;

-- 休暇種別を持てるのは休暇の日だけ。
ALTER TABLE work_schedules ADD CONSTRAINT work_schedules_leave_type_shape
  CHECK (leave_type_id IS NULL OR day_type = 'leave');
