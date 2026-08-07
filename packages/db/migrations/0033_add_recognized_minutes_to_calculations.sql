-- 承認しきった申請から来る、認定した分と認定の外に出た分。
--
-- どちらも追記型の表なので、過去の行は書き換えない。
-- これまでの行はこの区分を持たないため NULL のままにする。
-- 0 を入れると「計算した結果 0 分だった」と読め、
-- 「その版では承認を見ていない」と区別がつかなくなる。

ALTER TABLE attendance_calculations
  -- 認定した所定外。承認された上限時刻までに収まる、所定終業より後の実労働。
  -- 所定の時間帯が決まっていない日は NULL。
  ADD COLUMN recognized_overtime_minutes  integer,
  -- 認定の外に出た所定外。上限を超えた分と、承認の無い所定外。
  ADD COLUMN unapproved_overtime_minutes  integer,
  -- 休日労働のうち、承認のある分と無い分。
  ADD COLUMN approved_holiday_minutes     integer,
  ADD COLUMN unapproved_holiday_minutes   integer;

ALTER TABLE attendance_calculations
  ADD CONSTRAINT attendance_calculations_recognized_minutes_range
  CHECK (
    (recognized_overtime_minutes IS NULL OR recognized_overtime_minutes >= 0)
    AND (unapproved_overtime_minutes IS NULL OR unapproved_overtime_minutes >= 0)
    AND (approved_holiday_minutes IS NULL OR approved_holiday_minutes >= 0)
    AND (unapproved_holiday_minutes IS NULL OR unapproved_holiday_minutes >= 0)
  );

-- 締めた時点の月次にも同じ区分を持たせる。
--
-- 持たせないと、締めたあとに「認定した残業が何分だったか」を
-- 締めた値の側から言えなくなる。日次から足し直すと、締めた時点とは違う値が出る。
ALTER TABLE monthly_closing_snapshots
  ADD COLUMN recognized_overtime_minutes  integer,
  ADD COLUMN unapproved_overtime_minutes  integer,
  ADD COLUMN approved_holiday_minutes     integer,
  ADD COLUMN unapproved_holiday_minutes   integer;
