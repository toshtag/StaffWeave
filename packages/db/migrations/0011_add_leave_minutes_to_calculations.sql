-- 計算結果へ休暇と欠勤の時間を追加する。
--
-- どちらも実労働ではないため、既存の集計列とは分けて持つ。
-- 既存の行は 0 として扱う。過去の計算結果を作り直さないため、値の書き換えは行わない。

ALTER TABLE attendance_calculations
  ADD COLUMN leave_minutes   integer NOT NULL DEFAULT 0,
  ADD COLUMN absence_minutes integer NOT NULL DEFAULT 0;
