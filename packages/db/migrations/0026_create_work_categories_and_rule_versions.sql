-- 勤務区分と、版管理された計算規則。
--
-- 労務計算の値を、法令上の普遍的な既定値としてここへ埋め込まない。
-- 何時間で時間外になるか、どの曜日を法定休日にするかは、事業者の就業規則と
-- 労使協定で決まる。製品が既定値を持つと、設定しないまま計算が進み、
-- 誰も決めていない値が結果として残る。
--
-- したがって、閾値は NULL を許し、未設定のまま計算させない。
-- 未設定であることは呼ぶ側へ返し、そこで止める。
--
-- 設定は適用開始日つきで版を重ねる。過去の集計は当時の版で計算した結果を持ち、
-- あとからの設定変更で書き換わらない。

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 計算規則の版。
--
-- 既存の calculation_rule_sets は「ワークスペースに 1 行」で、履歴を持たない。
-- 版を重ねられないと、設定を変えた瞬間に過去の再計算まで新しい値になる。
-- そのため別の表にし、適用開始日で選ぶ。
CREATE TABLE calculation_rule_versions (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  effective_from            date        NOT NULL,
  -- 業務日の開始時刻（現地 0 時からの分数）。深夜勤務をどちらの日に入れるかを決める。
  day_start_minutes         integer     NOT NULL,
  night_start_minutes       integer     NOT NULL,
  night_end_minutes         integer     NOT NULL,
  rounding_minutes          integer     NOT NULL,
  rounding_mode             text        NOT NULL,
  -- 法定内と法定外を分ける閾値。設定しない限り、その区分は計算しない。
  daily_legal_minutes       integer,
  weekly_legal_minutes      integer,
  -- 集計の境界。週の開始曜日（0=日曜）と、月の締め開始日。
  week_starts_on            integer     NOT NULL,
  month_starts_on           integer     NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calculation_rule_versions_day_start
    CHECK (day_start_minutes BETWEEN 0 AND 1439),
  CONSTRAINT calculation_rule_versions_night_start
    CHECK (night_start_minutes BETWEEN 0 AND 1439),
  CONSTRAINT calculation_rule_versions_night_end
    CHECK (night_end_minutes BETWEEN 0 AND 1439),
  CONSTRAINT calculation_rule_versions_rounding
    CHECK (rounding_minutes BETWEEN 0 AND 60),
  CONSTRAINT calculation_rule_versions_rounding_mode
    CHECK (rounding_mode IN ('none', 'down', 'nearest')),
  CONSTRAINT calculation_rule_versions_daily_legal
    CHECK (daily_legal_minutes IS NULL OR daily_legal_minutes BETWEEN 1 AND 1440),
  CONSTRAINT calculation_rule_versions_weekly_legal
    CHECK (weekly_legal_minutes IS NULL OR weekly_legal_minutes BETWEEN 1 AND 10080),
  CONSTRAINT calculation_rule_versions_week_starts_on CHECK (week_starts_on BETWEEN 0 AND 6),
  CONSTRAINT calculation_rule_versions_month_starts_on CHECK (month_starts_on BETWEEN 1 AND 28),
  CONSTRAINT calculation_rule_versions_workspace_date_key UNIQUE (workspace_id, effective_from)
);

CREATE INDEX calculation_rule_versions_lookup_idx
  ON calculation_rule_versions (workspace_id, effective_from DESC);

-- いまある設定を、最初の版として引き継ぐ。
--
-- 引き継ぐのは、すでに使われていた値だけ。閾値と集計境界は決めた人がいないため
-- 空のままにする。空である限り、法定内外は計算しない。
INSERT INTO calculation_rule_versions (
  workspace_id, effective_from, day_start_minutes,
  night_start_minutes, night_end_minutes, rounding_minutes, rounding_mode,
  week_starts_on, month_starts_on
)
SELECT
  workspace_id, DATE '1970-01-01', 0,
  night_start_minutes, night_end_minutes, rounding_minutes, rounding_mode,
  0, 1
FROM calculation_rule_sets;

-- 勤務区分。
--
-- その日が働く日か、休む日か、休日かを表し、所定時刻と計算への算入を持つ。
-- 同じ code で版を重ね、適用期間が重ならないようにする。
-- 重なると、その日にどちらを使うかが取得順で決まってしまう。
CREATE TABLE work_categories (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code                  text        NOT NULL,
  -- 管理者が探すための名前と、従業員へ見せる名前を分ける。
  internal_name         text        NOT NULL,
  display_name          text        NOT NULL,
  category_type         text        NOT NULL,
  effective_from        date        NOT NULL,
  effective_to          date,
  -- 所定の時刻（現地 0 時からの分数）。日をまたぐ勤務では終業が 1440 を超える。
  scheduled_start_minutes integer,
  scheduled_end_minutes   integer,
  -- 所定労働分数。所定時刻から導かず、明示して持つ。
  prescribed_minutes    integer,
  -- みなし労働分数。裁量労働などで、実績と別に給与計算へ渡す値。
  deemed_minutes        integer,
  -- 深夜帯の上書き。空なら計算規則の版に従う。
  night_start_minutes   integer,
  night_end_minutes     integer,
  -- 区間と区間の間（中抜け）の扱い。
  gap_treatment         text        NOT NULL DEFAULT 'non_working',
  -- シフト表での見え方。
  shift                 boolean     NOT NULL DEFAULT false,
  color                 text,
  -- 集計への算入。
  counts_as_working_day boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_categories_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT work_categories_names_present
    CHECK (length(btrim(internal_name)) > 0 AND length(btrim(display_name)) > 0),
  CONSTRAINT work_categories_type_values
    CHECK (category_type IN ('working_day', 'non_working_day', 'legal_holiday', 'leave', 'absence')),
  CONSTRAINT work_categories_gap_values
    CHECK (gap_treatment IN ('non_working', 'break')),
  CONSTRAINT work_categories_scheduled_start
    CHECK (scheduled_start_minutes IS NULL OR scheduled_start_minutes BETWEEN 0 AND 1439),
  CONSTRAINT work_categories_scheduled_end
    CHECK (scheduled_end_minutes IS NULL OR scheduled_end_minutes BETWEEN 1 AND 2879),
  CONSTRAINT work_categories_scheduled_order
    CHECK (
      scheduled_start_minutes IS NULL
      OR scheduled_end_minutes IS NULL
      OR scheduled_end_minutes > scheduled_start_minutes
    ),
  CONSTRAINT work_categories_prescribed_range
    CHECK (prescribed_minutes IS NULL OR prescribed_minutes BETWEEN 0 AND 1440),
  CONSTRAINT work_categories_deemed_range
    CHECK (deemed_minutes IS NULL OR deemed_minutes BETWEEN 0 AND 1440),
  CONSTRAINT work_categories_night_start
    CHECK (night_start_minutes IS NULL OR night_start_minutes BETWEEN 0 AND 1439),
  CONSTRAINT work_categories_night_end
    CHECK (night_end_minutes IS NULL OR night_end_minutes BETWEEN 0 AND 1439),
  -- 深夜帯は両方そろって初めて上書きになる。片方だけでは意味が決まらない。
  CONSTRAINT work_categories_night_pair
    CHECK ((night_start_minutes IS NULL) = (night_end_minutes IS NULL)),
  CONSTRAINT work_categories_effective_order
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT work_categories_id_workspace_key UNIQUE (id, workspace_id)
);

-- 同じ code の版が重ならないようにする。終了日が無い版は、それ以降ずっと続く。
ALTER TABLE work_categories
  ADD CONSTRAINT work_categories_no_overlap
  EXCLUDE USING gist (
    workspace_id WITH =,
    code WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- 固定休憩。実際の休憩打刻が無くても、所定として引く時間帯。
CREATE TABLE work_category_fixed_breaks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  work_category_id uuid        NOT NULL,
  start_minutes    integer     NOT NULL,
  end_minutes      integer     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_category_fixed_breaks_range
    CHECK (start_minutes BETWEEN 0 AND 2878 AND end_minutes BETWEEN 1 AND 2879),
  CONSTRAINT work_category_fixed_breaks_order CHECK (end_minutes > start_minutes),
  CONSTRAINT work_category_fixed_breaks_category_fkey
    FOREIGN KEY (work_category_id, workspace_id)
    REFERENCES work_categories (id, workspace_id) ON DELETE CASCADE
);

-- 同じ勤務区分の中で、固定休憩の時間帯が重ならないようにする。
-- 重なると、同じ時間を二度引くか、どちらを採るかが取得順で決まる。
ALTER TABLE work_category_fixed_breaks
  ADD CONSTRAINT work_category_fixed_breaks_no_overlap
  EXCLUDE USING gist (
    work_category_id WITH =,
    int4range(start_minutes, end_minutes, '[)') WITH &&
  );

-- 自動休憩。実労働が閾値を超えたら、その分だけ休憩として引く。
CREATE TABLE work_category_auto_breaks (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  work_category_id   uuid        NOT NULL,
  -- この分数を超えたら適用する。
  threshold_minutes  integer     NOT NULL,
  -- 足す休憩の分数。
  additional_minutes integer     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_category_auto_breaks_threshold CHECK (threshold_minutes BETWEEN 1 AND 1440),
  CONSTRAINT work_category_auto_breaks_additional
    CHECK (additional_minutes BETWEEN 1 AND 1440),
  CONSTRAINT work_category_auto_breaks_threshold_key UNIQUE (work_category_id, threshold_minutes),
  CONSTRAINT work_category_auto_breaks_category_fkey
    FOREIGN KEY (work_category_id, workspace_id)
    REFERENCES work_categories (id, workspace_id) ON DELETE CASCADE
);

-- 勤務予定から勤務区分を指すための列。既存の勤務パターンは所定時刻のひな形として残す。
ALTER TABLE work_schedules
  ADD COLUMN work_category_id uuid,
  ADD CONSTRAINT work_schedules_work_category_fkey
    FOREIGN KEY (work_category_id, workspace_id)
    REFERENCES work_categories (id, workspace_id) ON DELETE SET NULL;

CREATE INDEX work_categories_lookup_idx
  ON work_categories (workspace_id, code, effective_from DESC);
