-- 長時間労働の警告に使う上限。
--
-- 何時間を超えたら知らせるかは、事業者の就業規則と労使協定で決まる。
-- 製品は既定値を持たない。設定しないかぎり警告を出さず、未設定として示す。
--
-- 「1 か月」と「複数月の平均」を分けて持つ。片方だけの運用があるため、
-- どちらも空を許す。

ALTER TABLE calculation_rule_versions
  -- 1 か月の法定時間外の上限（分）。
  ADD COLUMN monthly_overtime_limit_minutes integer,
  -- 複数月の平均の上限（分）と、平均を取る月数。
  ADD COLUMN average_overtime_limit_minutes integer,
  ADD COLUMN average_overtime_months        integer;

ALTER TABLE calculation_rule_versions
  ADD CONSTRAINT calculation_rule_versions_monthly_overtime_limit
    CHECK (
      monthly_overtime_limit_minutes IS NULL
      OR monthly_overtime_limit_minutes BETWEEN 1 AND 100000
    ),
  ADD CONSTRAINT calculation_rule_versions_average_overtime_limit
    CHECK (
      average_overtime_limit_minutes IS NULL
      OR average_overtime_limit_minutes BETWEEN 1 AND 100000
    ),
  ADD CONSTRAINT calculation_rule_versions_average_overtime_months
    CHECK (average_overtime_months IS NULL OR average_overtime_months BETWEEN 2 AND 12),
  -- 平均の上限は、月数とそろって初めて意味が決まる。
  ADD CONSTRAINT calculation_rule_versions_average_overtime_pair
    CHECK ((average_overtime_limit_minutes IS NULL) = (average_overtime_months IS NULL));
