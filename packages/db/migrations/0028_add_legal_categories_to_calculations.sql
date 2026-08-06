-- 計算結果へ、法定の区分と遅刻・早退・みなしを足す。
--
-- 追記型の表なので、過去の行は書き換えない。
-- これまでの行はこれらの区分を持たないため NULL のままにする。
-- 0 を入れると「計算した結果 0 分だった」と読め、
-- 「その版では計算していない」と区別がつかなくなる。

ALTER TABLE attendance_calculations
  -- 法定内時間外・法定時間外。1 日の閾値が未設定なら NULL。
  ADD COLUMN legal_inside_overtime_minutes integer,
  ADD COLUMN legal_overtime_minutes        integer,
  -- 法定休日と法定外休日を分けて持つ。
  ADD COLUMN legal_holiday_minutes         integer,
  ADD COLUMN non_legal_holiday_minutes     integer,
  -- 深夜のうち、法定時間外・休日労働に当たる分。
  ADD COLUMN night_overtime_minutes        integer,
  ADD COLUMN night_holiday_minutes         integer,
  -- 所定との差。
  ADD COLUMN late_minutes                  integer,
  ADD COLUMN early_leave_minutes           integer,
  ADD COLUMN before_schedule_minutes       integer,
  ADD COLUMN after_schedule_minutes        integer,
  -- 給与向けのみなし労働。実績とは別に持つ。
  ADD COLUMN deemed_minutes                integer;

-- 追記型の表は書き換えないため、値の範囲だけを制約で押さえる。
ALTER TABLE attendance_calculations
  ADD CONSTRAINT attendance_calculations_legal_minutes_range
  CHECK (
    (legal_inside_overtime_minutes IS NULL OR legal_inside_overtime_minutes >= 0)
    AND (legal_overtime_minutes IS NULL OR legal_overtime_minutes >= 0)
    AND (legal_holiday_minutes IS NULL OR legal_holiday_minutes >= 0)
    AND (non_legal_holiday_minutes IS NULL OR non_legal_holiday_minutes >= 0)
    AND (night_overtime_minutes IS NULL OR night_overtime_minutes >= 0)
    AND (night_holiday_minutes IS NULL OR night_holiday_minutes >= 0)
    AND (late_minutes IS NULL OR late_minutes >= 0)
    AND (early_leave_minutes IS NULL OR early_leave_minutes >= 0)
    AND (before_schedule_minutes IS NULL OR before_schedule_minutes >= 0)
    AND (after_schedule_minutes IS NULL OR after_schedule_minutes >= 0)
    AND (deemed_minutes IS NULL OR deemed_minutes >= 0)
  );

-- 勤務予定の日種別へ法定休日を足す。
--
-- いまの値は 0010 で休暇と欠勤まで広げてある。取りこぼすと、
-- すでに登録されている予定が保存できなくなる。
ALTER TABLE work_schedules
  DROP CONSTRAINT IF EXISTS work_schedules_day_type_values;

ALTER TABLE work_schedules
  ADD CONSTRAINT work_schedules_day_type_values
  CHECK (
    day_type IN (
      'working_day', 'non_working_day', 'legal_holiday', 'public_holiday', 'leave', 'absence'
    )
  );
