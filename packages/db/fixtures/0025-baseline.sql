-- 支える upgrade の起点（0025 まで）に居る利用者の、代表的なデータ。
--
-- あとから足した migration を当てられるかは、空のテーブルでは分からない。
-- 列を足すときの NOT NULL、値の範囲を狭める検査、期間の重なりを禁じる制約は、
-- 行が無ければ必ず通る。
--
-- ここへ置くのは、0025 の時点で作れた形だけ。
-- あとの版で足した列や表を使うと、起点の再現にならない。
--
-- 起点を上げるときは packages/db/fixtures/README.md を読むこと。

INSERT INTO workspaces (slug, name, time_zone)
VALUES ('upgrade', '移行の確認', 'Asia/Tokyo');

INSERT INTO organizations (workspace_id, code, name)
SELECT id, 'HQ', '本社' FROM workspaces WHERE slug = 'upgrade';

INSERT INTO sites (workspace_id, organization_id, code, name, time_zone)
SELECT o.workspace_id, o.id, 'TOKYO', '東京', 'Asia/Tokyo' FROM organizations o;

INSERT INTO users (workspace_id, email, password_hash, display_name)
SELECT id, 'upgrade@example.test', 'x', '移行 太郎' FROM workspaces WHERE slug = 'upgrade';

INSERT INTO user_roles (workspace_id, user_id, role)
SELECT workspace_id, id, 'workspace_admin' FROM users;

INSERT INTO employees
  (workspace_id, organization_id, user_id, employee_number, display_name, primary_site_id)
SELECT o.workspace_id, o.id, u.id, 'E001', '移行 太郎', s.id
  FROM organizations o
  JOIN users u ON u.workspace_id = o.workspace_id
  JOIN sites s ON s.workspace_id = o.workspace_id;

-- 打刻と、そこから作った計算。あとの版が列を足す先。
INSERT INTO attendance_events
  (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
SELECT workspace_id, id, 'clock_in', '2026-04-01T00:00:00Z', '2026-04-01', 'web', 'upgrade-in-01'
  FROM employees;

INSERT INTO attendance_events
  (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
SELECT workspace_id, id, 'clock_out', '2026-04-01T09:00:00Z', '2026-04-01', 'web', 'upgrade-out-01'
  FROM employees;

INSERT INTO attendance_calculations
  (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
   attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
   within_schedule_minutes, outside_schedule_minutes, night_minutes,
   non_working_day_minutes, leave_minutes, absence_minutes, basis)
SELECT workspace_id, id, '2026-04-01', 1, 'upgrade-fingerprint', 'baseline',
       540, 540, 0, 480, 480, 60, 0, 0, 0, 0, '{}'::jsonb
  FROM employees;

-- 申請と締め。0026 以降が参照する側。
INSERT INTO daily_attendance_requests
  (workspace_id, employee_id, business_date, state, submissions, returns)
SELECT workspace_id, id, '2026-04-01', 'approved', 1, 0 FROM employees;

INSERT INTO monthly_closings (workspace_id, employee_id, period, state, reopens)
SELECT workspace_id, id, '2026-04-01', 'closed', 0 FROM employees;

-- 休暇種別。0029 が列を足す先。
INSERT INTO leave_types (workspace_id, code, name, paid)
SELECT id, 'PAID', '年次有給', true FROM workspaces WHERE slug = 'upgrade';

-- 勤務予定。0026 が勤務区分の列を足し、0028 が日種別の許す値を広げる先。
INSERT INTO work_patterns (workspace_id, code, name, start_minutes, end_minutes, break_minutes)
SELECT id, 'DAY', '日勤', 540, 1080, 60 FROM workspaces WHERE slug = 'upgrade';

INSERT INTO work_schedules
  (workspace_id, employee_id, business_date, day_type, start_minutes, end_minutes, break_minutes)
SELECT workspace_id, id, '2026-04-01', 'working_day', 540, 1080, 60 FROM employees;

-- 計算規則。0026 が版として写し取る先。
INSERT INTO calculation_rule_sets
  (workspace_id, night_start_minutes, night_end_minutes, rounding_minutes, rounding_mode)
SELECT id, 1320, 300, 15, 'down' FROM workspaces WHERE slug = 'upgrade';

-- 外部連携。0032 が列を足す先。
INSERT INTO webhook_endpoints (workspace_id, name, url, signing_key, event_types)
SELECT id, '連携先', 'https://example.test/hooks', repeat('a', 64),
       ARRAY['monthly_closing.closed']
  FROM workspaces WHERE slug = 'upgrade';

INSERT INTO webhook_outbox
  (workspace_id, endpoint_id, event_type, event_id, payload, occurred_at)
SELECT workspace_id, id, 'monthly_closing.closed', 'upgrade-event-01', '{}'::jsonb, now()
  FROM webhook_endpoints;

INSERT INTO webhook_deliveries
  (workspace_id, endpoint_id, event_type, event_id, payload, outcome)
SELECT workspace_id, id, 'monthly_closing.closed', 'upgrade-event-01', '{}'::jsonb, 'failed'
  FROM webhook_endpoints;

-- 端末と監査。
-- 有効な端末は公開鍵を持つ。持たない有効な端末は制約が断る。
INSERT INTO devices (workspace_id, name, state, public_key, enrolled_at, enrollments)
SELECT id, '打刻端末', 'active', '-- 検証用の値 --', now(), 1
  FROM workspaces WHERE slug = 'upgrade';

INSERT INTO audit_logs (workspace_id, actor_kind, action, target_type, summary)
SELECT id, 'system', 'upgrade.baseline', 'workspace', '移行の起点' FROM workspaces
 WHERE slug = 'upgrade';
