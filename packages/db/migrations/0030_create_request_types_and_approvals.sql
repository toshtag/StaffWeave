-- 申請種別と段階承認。
--
-- いまの申請は日次勤怠の 1 種類・1 段階だけで、従業員と日付ごとに 1 件しか持てない。
-- 休暇、残業、休日出勤、打刻修正を同じ基盤で扱えるようにする。
--
-- 承認の経路は、申請を出した時点の定義を写して固定する。
-- 定義を参照したままだと、承認の途中で段階を増減されたときに、
-- すでに承認した段階が消えたり、承認していない段階が現れたりする。

-- 申請種別。組織が定義する。
CREATE TABLE request_types (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code           text        NOT NULL,
  name           text        NOT NULL,
  -- 何についての申請か。反映先が変わる。
  category       text        NOT NULL,
  -- 承認の段数。1〜4。
  approval_steps integer     NOT NULL,
  -- 入力項目の要否。区分ごとに変える。
  requires_reason      boolean NOT NULL DEFAULT true,
  requires_leave_type  boolean NOT NULL DEFAULT false,
  requires_time_range  boolean NOT NULL DEFAULT false,
  -- 残業の上限時刻を入力させるか。認定時間の計算へ使う。
  requires_overtime_limit boolean NOT NULL DEFAULT false,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT request_types_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT request_types_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT request_types_category_values
    CHECK (category IN ('leave', 'overtime', 'holiday_work', 'attendance_correction', 'other')),
  CONSTRAINT request_types_steps_range CHECK (approval_steps BETWEEN 1 AND 4),
  -- 休暇の申請は、どの休暇種別かが決まらないと台帳へ反映できない。
  CONSTRAINT request_types_leave_requires_type
    CHECK (category <> 'leave' OR requires_leave_type),
  CONSTRAINT request_types_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX request_types_workspace_code_key ON request_types (workspace_id, code);

-- 申請。日付ごとに 1 件という制限は持たない。
CREATE TABLE employee_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_type_id   uuid        NOT NULL,
  employee_id       uuid        NOT NULL,
  state             text        NOT NULL DEFAULT 'submitted',
  -- 申請を出した時点で写した段数。定義を変えても、この申請の段数は動かない。
  total_steps       integer     NOT NULL,
  -- いま何段目を待っているか。承認が済めば段数と同じになる。
  current_step      integer     NOT NULL DEFAULT 1,
  business_date     date        NOT NULL,
  ends_on           date,
  leave_type_id     uuid,
  -- 申請する時刻（現地 0 時からの分数）。
  start_minutes     integer,
  end_minutes       integer,
  -- 残業の上限時刻。
  overtime_limit_minutes integer,
  reason            text,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employee_requests_state_values
    CHECK (state IN ('submitted', 'approved', 'returned', 'cancelled')),
  CONSTRAINT employee_requests_total_steps_range CHECK (total_steps BETWEEN 1 AND 4),
  CONSTRAINT employee_requests_current_step_range
    CHECK (current_step BETWEEN 1 AND total_steps),
  CONSTRAINT employee_requests_period_order CHECK (ends_on IS NULL OR ends_on >= business_date),
  CONSTRAINT employee_requests_time_order
    CHECK (
      (start_minutes IS NULL) = (end_minutes IS NULL)
      AND (end_minutes IS NULL OR end_minutes > start_minutes)
    ),
  CONSTRAINT employee_requests_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT employee_requests_type_fkey
    FOREIGN KEY (request_type_id, workspace_id)
    REFERENCES request_types (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT employee_requests_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employee_requests_leave_type_fkey
    FOREIGN KEY (leave_type_id, workspace_id)
    REFERENCES leave_types (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX employee_requests_pending_idx
  ON employee_requests (workspace_id, state, business_date);
CREATE INDEX employee_requests_employee_idx
  ON employee_requests (workspace_id, employee_id, business_date);

-- 段階ごとの決裁。追記のみ。
--
-- 誰がどの段を、いつ、どう決めたかを残す。
-- 差し戻しのあとに再提出したときは、前の決裁も残したまま新しい行を積む。
CREATE TABLE employee_request_approvals (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id     uuid        NOT NULL,
  step           integer     NOT NULL,
  -- 何回目の提出に対する決裁か。再提出のたびに増える。
  submission     integer     NOT NULL,
  decision       text        NOT NULL,
  decided_by_user_id uuid,
  -- 代理承認のとき、本来の承認者。
  on_behalf_of_user_id uuid,
  comment        text,
  decided_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employee_request_approvals_decision_values
    CHECK (decision IN ('approved', 'returned')),
  CONSTRAINT employee_request_approvals_step_range CHECK (step BETWEEN 1 AND 4),
  CONSTRAINT employee_request_approvals_request_fkey
    FOREIGN KEY (request_id, workspace_id)
    REFERENCES employee_requests (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employee_request_approvals_decider_fkey
    FOREIGN KEY (decided_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT employee_request_approvals_behalf_fkey
    FOREIGN KEY (on_behalf_of_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 同じ提出の同じ段を二度決裁できないようにする。
-- 古い画面から同じ承認を送り直しても、二段目へ勝手に進まない。
CREATE UNIQUE INDEX employee_request_approvals_step_once_key
  ON employee_request_approvals (workspace_id, request_id, submission, step);

CREATE INDEX employee_request_approvals_request_idx
  ON employee_request_approvals (workspace_id, request_id, decided_at);

-- 決裁は追記のみ。
CREATE TRIGGER employee_request_approvals_append_only
  BEFORE UPDATE OR DELETE ON employee_request_approvals
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- 提出回数。再提出のたびに増やし、決裁と突き合わせる。
ALTER TABLE employee_requests
  ADD COLUMN submissions integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT employee_requests_submissions_positive CHECK (submissions >= 1);

-- 台帳の消化を、この申請へ結び付けられるようにする。
ALTER TABLE leave_ledger_entries
  ADD CONSTRAINT leave_ledger_entries_request_fkey
  FOREIGN KEY (request_id, workspace_id)
  REFERENCES employee_requests (id, workspace_id) ON DELETE RESTRICT;
