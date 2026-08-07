-- 勤務周期の 1 日へ勤務区分を持たせる。
--
-- 勤務予定は work_schedules.work_category_id で勤務区分を指す。手で登録する経路は
-- そこへ直に書けるが、周期から生成する経路には元になる値が無く、生成した予定は
-- 必ず勤務区分の無い状態になる。生成を使うほど、設定した固定休憩や深夜帯が
-- 計算へ届かない日が増える。
--
-- 勤務パターンと勤務区分は役割が違う。パターンは所定時刻のひな形だけを持ち、
-- 区分は休憩・みなし・深夜帯・中抜けの扱いを持つ。片方で他方を代用できない。
-- そのため列を分けて両方を持たせる。
--
-- 既存の周期は勤務区分を持たないまま残す。NOT NULL にすると、いま動いている
-- 周期の全てに、誰も決めていない区分を埋めることになる。
ALTER TABLE work_cycle_days
  ADD COLUMN work_category_id uuid,
  ADD CONSTRAINT work_cycle_days_category_fkey
    FOREIGN KEY (work_category_id, workspace_id)
    REFERENCES work_categories (id, workspace_id) ON DELETE RESTRICT;
