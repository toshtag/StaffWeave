-- ワークスペース全体を対象にした期間の検索へ索引を足す。
--
-- これまでの索引は、いずれも従業員を 2 番目に置いていた。
--   attendance_events                (workspace_id, employee_id, business_date, occurred_at)
--   attendance_calculations          (workspace_id, employee_id, business_date, version DESC)
--   workstation_session_observations (workspace_id, employee_id, business_date, occurred_at)
--
-- 一方、従業員を指定しない問い合わせがある。管理者が期間を指定して全体を見る経路
-- （CSV 出力、異常の一覧、観測の一覧、申請と締めの一覧）は必ずこの形になる。
-- 先頭から条件が一致しないため、期間で絞れずワークスペースの全期間を読んでいた。
--
-- 打刻も計算結果も追記のみで、行が減ることはない。読む量が期間ではなく総量に
-- 比例するため、運用を続けるほど遅くなる。
--
-- 従業員を 3 番目へ置くのは、期間で絞ったあとに従業員ごとへまとめる問い合わせ
-- （修正の多発、重複打刻の判定）が索引の中で従業員を読めるようにするため。

CREATE INDEX attendance_events_workspace_day_idx
  ON attendance_events (workspace_id, business_date, employee_id);

CREATE INDEX attendance_calculations_workspace_day_idx
  ON attendance_calculations (workspace_id, business_date, employee_id);

CREATE INDEX workstation_session_observations_workspace_day_idx
  ON workstation_session_observations (workspace_id, business_date, employee_id);

CREATE INDEX daily_attendance_requests_workspace_day_idx
  ON daily_attendance_requests (workspace_id, business_date, employee_id);

CREATE INDEX monthly_closings_workspace_period_idx
  ON monthly_closings (workspace_id, period, employee_id);

-- 端末の受領記録だけは業務日を持たず、受け取った時刻で絞る。
CREATE INDEX device_event_receipts_workspace_received_idx
  ON device_event_receipts (workspace_id, received_at);
