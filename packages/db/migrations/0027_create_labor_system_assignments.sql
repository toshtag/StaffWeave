-- 労働形態の割当。
--
-- 通常、フレックスタイム、裁量労働、変形労働時間を、従業員ごとに期間で割り当てる。
-- 制度ごとの値（清算期間、コアタイム、みなし分数、対象期間の総枠）は事業者が決める。
-- 製品は既定値を持たない。未設定のまま計算へ進むと、誰も決めていない値が結果に残る。
--
-- 汎用のルール言語は作らない。ここで扱う 4 つの制度に必要な項目だけを列として持つ。
-- 列にしておけば、どの制度がどの値を要るのかを制約で示せる。

CREATE TABLE labor_system_assignments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id           uuid        NOT NULL,
  system_type           text        NOT NULL,
  effective_from        date        NOT NULL,
  effective_to          date,

  -- フレックスタイムと変形労働時間で使う清算・対象期間。
  -- 期間の長さ（月数）と、起算月。
  settlement_months     integer,
  settlement_starts_on  date,
  -- 総枠の決め方。法定の総枠に合わせるか、所定の合計に合わせるか。
  settlement_basis      text,
  -- 期間の総枠（分）。事業者が決めた値をそのまま持つ。
  settlement_total_minutes integer,
  -- コアタイムとフレキシブルタイム（現地 0 時からの分数）。
  core_start_minutes    integer,
  core_end_minutes      integer,
  flexible_start_minutes integer,
  flexible_end_minutes  integer,

  -- 裁量労働のみなし分数。実績は別に持ち、給与向けの値としてこちらを使う。
  deemed_minutes        integer,

  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by_user_id    uuid,

  CONSTRAINT labor_system_assignments_type_values
    CHECK (system_type IN ('normal', 'flex', 'discretionary', 'variable')),
  CONSTRAINT labor_system_assignments_effective_order
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT labor_system_assignments_settlement_months
    CHECK (settlement_months IS NULL OR settlement_months BETWEEN 1 AND 12),
  CONSTRAINT labor_system_assignments_settlement_basis
    CHECK (settlement_basis IS NULL OR settlement_basis IN ('legal', 'prescribed')),
  CONSTRAINT labor_system_assignments_settlement_total
    CHECK (settlement_total_minutes IS NULL OR settlement_total_minutes BETWEEN 1 AND 1000000),
  CONSTRAINT labor_system_assignments_core_range
    CHECK (
      (core_start_minutes IS NULL) = (core_end_minutes IS NULL)
      AND (core_end_minutes IS NULL OR core_end_minutes > core_start_minutes)
    ),
  CONSTRAINT labor_system_assignments_flexible_range
    CHECK (
      (flexible_start_minutes IS NULL) = (flexible_end_minutes IS NULL)
      AND (flexible_end_minutes IS NULL OR flexible_end_minutes > flexible_start_minutes)
    ),
  CONSTRAINT labor_system_assignments_deemed_range
    CHECK (deemed_minutes IS NULL OR deemed_minutes BETWEEN 0 AND 1440),

  -- 制度ごとに、そろっていなければならない値を DB でも要求する。
  -- 揃っていない割当を作れると、計算のたびに「未設定」を返すだけの行が増える。
  CONSTRAINT labor_system_assignments_flex_requires_settlement
    CHECK (
      system_type <> 'flex'
      OR (
        settlement_months IS NOT NULL
        AND settlement_starts_on IS NOT NULL
        AND settlement_basis IS NOT NULL
        AND settlement_total_minutes IS NOT NULL
      )
    ),
  CONSTRAINT labor_system_assignments_variable_requires_settlement
    CHECK (
      system_type <> 'variable'
      OR (
        settlement_months IS NOT NULL
        AND settlement_starts_on IS NOT NULL
        AND settlement_total_minutes IS NOT NULL
      )
    ),
  CONSTRAINT labor_system_assignments_discretionary_requires_deemed
    CHECK (system_type <> 'discretionary' OR deemed_minutes IS NOT NULL),

  CONSTRAINT labor_system_assignments_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT labor_system_assignments_creator_fkey
    FOREIGN KEY (created_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 同じ従業員に、期間の重なる割当を作れないようにする。
-- 重なると、その日にどちらの制度で計算するかが取得順で決まる。
ALTER TABLE labor_system_assignments
  ADD CONSTRAINT labor_system_assignments_no_overlap
  EXCLUDE USING gist (
    workspace_id WITH =,
    employee_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

CREATE INDEX labor_system_assignments_lookup_idx
  ON labor_system_assignments (workspace_id, employee_id, effective_from DESC);
