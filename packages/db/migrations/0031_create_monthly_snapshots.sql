-- 締めたときの月次集計を、その場で固める。
--
-- 日次の計算は追記型で、版を重ねる。締めたあとに打刻を訂正すれば新しい版ができ、
-- 月次を毎回その場で足し直すと、締めたときとは違う値が出る。
--
-- 給与へ渡した値と、あとから画面に出る値が食い違うと、
-- どちらが正しいのかを人が説明することになる。締めた時点の値を残しておけば、
-- 「締めたのはこの値、いまの日次はこの値」と並べて示せる。
--
-- 締めを解除して締め直すと、新しい行を積む。前の行は消さない。
-- 消すと、いつ何を給与へ渡したのかが辿れなくなる。

CREATE TABLE monthly_closing_snapshots (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id    uuid        NOT NULL,
  -- 対象月の 1 日。
  period         date        NOT NULL,
  -- 何回目の締めか。締め直すたびに増える。
  sequence       integer     NOT NULL,
  closed_at      timestamptz NOT NULL DEFAULT now(),
  closed_by_user_id uuid,

  -- 集計へ入れた日の数と、そのときの日次の版。
  -- 版を残すのは、あとから「この合計はどの計算から来たか」を辿るため。
  counted_days   integer     NOT NULL,
  day_versions   jsonb       NOT NULL,

  attended_minutes         integer NOT NULL,
  worked_minutes           integer NOT NULL,
  break_minutes            integer NOT NULL,
  scheduled_minutes        integer NOT NULL,
  within_schedule_minutes  integer NOT NULL,
  outside_schedule_minutes integer NOT NULL,
  night_minutes            integer NOT NULL,
  non_working_day_minutes  integer NOT NULL,
  leave_minutes            integer NOT NULL,
  absence_minutes          integer NOT NULL,
  worked_days              integer NOT NULL,
  leave_days               integer NOT NULL,

  -- 法定の区分。閾値が未設定の日が 1 日でもあれば NULL。
  -- 0 にすると「計算した結果 0 分」と読めてしまい、未設定と区別がつかない。
  legal_inside_overtime_minutes integer,
  legal_overtime_minutes        integer,
  legal_holiday_minutes         integer,
  non_legal_holiday_minutes     integer,
  night_overtime_minutes        integer,
  night_holiday_minutes         integer,
  late_minutes                  integer,
  early_leave_minutes           integer,
  deemed_minutes                integer,

  CONSTRAINT monthly_closing_snapshots_period_is_first_day
    CHECK (date_part('day', period) = 1),
  CONSTRAINT monthly_closing_snapshots_sequence_positive CHECK (sequence >= 1),
  CONSTRAINT monthly_closing_snapshots_counted_days_not_negative CHECK (counted_days >= 0),
  CONSTRAINT monthly_closing_snapshots_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT monthly_closing_snapshots_closer_fkey
    FOREIGN KEY (closed_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 同じ回の締めを二度書けないようにする。
-- 同時に届いた締めでも、記録が 2 行に増えない。
CREATE UNIQUE INDEX monthly_closing_snapshots_sequence_key
  ON monthly_closing_snapshots (workspace_id, employee_id, period, sequence);

CREATE INDEX monthly_closing_snapshots_period_idx
  ON monthly_closing_snapshots (workspace_id, period, employee_id);

-- 締めた記録は追記のみ。書き換えと削除を DB で止める。
CREATE TRIGGER monthly_closing_snapshots_append_only
  BEFORE UPDATE OR DELETE ON monthly_closing_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
