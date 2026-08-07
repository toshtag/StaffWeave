-- 休暇の付与規則と、一括で積んだ記録の出どころ。
--
-- 付与は手作業の 1 件ずつしか無かった。数十人の組織でも、基準日に
-- ひとりずつ付与するのは現実的ではない。
--
-- 付与する分数は事業者が決める。製品は法定の日数を既定値として持たない。
-- 勤続に応じて何日付与するかは、就業規則と労使協定で決まる。
-- 規則を置かないかぎり、自動でも一斉でも 1 分も付与しない。

-- 休暇種別へ、自動付与の基準を持たせる。
--
-- 空なら自動付与しない。入社日基準と一斉付与を分けるのは、
-- 対象になる従業員が違うため。入社日基準では、その日が記念日の人だけが対象になる。
ALTER TABLE leave_types
  ADD COLUMN grant_basis text;

ALTER TABLE leave_types
  ADD CONSTRAINT leave_types_grant_basis_values
    CHECK (grant_basis IS NULL OR grant_basis IN ('hire_anniversary', 'fixed_date'));

-- 勤続の段階ごとの付与分数。
--
-- 「勤続 6 か月で 10 日、1 年 6 か月で 11 日」のような段階を、行として持つ。
-- 汎用の式は作らない。式にすると、何が設定されているのかを人が読めなくなる。
CREATE TABLE leave_grant_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  leave_type_id   uuid        NOT NULL,
  -- この勤続月数に達したら、この分数を付与する。
  -- いちばん大きい、達している段を採る。
  service_months  integer     NOT NULL,
  minutes         integer     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leave_grant_rules_service_months_range
    CHECK (service_months BETWEEN 0 AND 600),
  CONSTRAINT leave_grant_rules_minutes_positive
    CHECK (minutes BETWEEN 1 AND 525600),
  CONSTRAINT leave_grant_rules_leave_type_fkey
    FOREIGN KEY (leave_type_id, workspace_id)
    REFERENCES leave_types (id, workspace_id) ON DELETE CASCADE
);

-- 同じ段を二度置けないようにする。二度あると、どちらを採るかが取得順で決まる。
CREATE UNIQUE INDEX leave_grant_rules_step_key
  ON leave_grant_rules (workspace_id, leave_type_id, service_months);

-- 台帳の記録が、どこから来たかを持たせる。
--
-- 手作業と、規則による付与と、申請からの消化と、CSV の取込を区別する。
-- 区別しないと、二重付与を止める制約を手作業の付与にまで当てることになる。
ALTER TABLE leave_ledger_entries
  ADD COLUMN source text NOT NULL DEFAULT 'manual';

ALTER TABLE leave_ledger_entries
  ADD CONSTRAINT leave_ledger_entries_source_values
    CHECK (source IN ('manual', 'rule', 'import', 'request'));

-- 自動でも CSV でも、同じ従業員・同じ休暇種別・同じ日への付与は 1 回だけ。
--
-- 二重付与は残数を増やしてしまい、気付くのは使い切ったあとになる。
-- 手作業の付与はここで止めない。同じ日に別の理由で足す判断は、人が行う。
CREATE UNIQUE INDEX leave_ledger_entries_bulk_grant_once_key
  ON leave_ledger_entries (workspace_id, employee_id, leave_type_id, effective_on)
  WHERE entry_type = 'grant' AND source IN ('rule', 'import');
