#!/bin/sh
# 既にデータが入っているデータベースへ、あとから足した migration を当てられるか確かめる。
#
#   DATABASE_URL=postgres://... ./scripts/verify-upgrade.sh
#
# まっさらなデータベースへ全部を流すのは db:migrate で見ている。
# それだけでは、既にある行と衝突する変更に気付けない。
# 列を足すときの NOT NULL、値の範囲を狭める検査、期間の重なりを禁じる制約は、
# 空のテーブルなら必ず通る。
#
# 支える起点まで流し、その版の代表的なデータを入れ、そこから最新までを順に当てる。
# 1 件ずつ順に当てるのは、途中のどれで止まるかを分かるようにするため。
# まとめて当てると「どこかで落ちた」しか分からない。
#
# 起点と代表データは packages/db/fixtures にある。
set -eu

# 接続先は .env からも読む。他の検証（db:verify など）は tsx が .env を読むため、
# ここだけ環境変数を要求すると、同じ `pnpm verify` の中で片方だけが落ちる。
load_database_url() {
  [ -n "${DATABASE_URL:-}" ] && return 0
  root=$(cd "$(dirname "$0")/.." && pwd)
  [ -f "$root/.env" ] || return 0
  value=$(grep -m 1 '^DATABASE_URL=' "$root/.env" | cut -d= -f2- | tr -d '"\'"'"'')
  [ -n "$value" ] && DATABASE_URL="$value" && export DATABASE_URL
  return 0
}
load_database_url

if ! command -v psql > /dev/null 2>&1; then
  echo 'psql が要ります（postgresql-client）。' >&2
  exit 1
fi

BASE_URL="${DATABASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  echo 'DATABASE_URL を設定してください。' >&2
  exit 1
fi

UPGRADE_DB="staffweave_upgrade_check"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATIONS="$ROOT/packages/db/migrations"

# 支える upgrade の起点。ここまで当たっているデータベースからの移行を確かめる。
# 上げ方は packages/db/fixtures/README.md にある。
BASELINE="0025"
FIXTURE="$ROOT/packages/db/fixtures/$BASELINE-baseline.sql"

url_for() {
  printf '%s' "$BASE_URL" | sed "s#/[^/?]*\(?.*\)\{0,1\}\$#/$1#"
}

ADMIN_URL=$(url_for postgres)
UPGRADE_URL=$(url_for "$UPGRADE_DB")

cleanup() {
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $UPGRADE_DB" > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [ ! -f "$FIXTURE" ]; then
  echo "起点の代表データがありません: $FIXTURE" >&2
  exit 1
fi

BASELINE_FILE=$(ls "$MIGRATIONS" | grep -E "^${BASELINE}_.*\\.sql$" | head -1)
if [ -z "$BASELINE_FILE" ]; then
  echo "起点の migration が見つかりません: $BASELINE" >&2
  exit 1
fi

echo "起点まで流します（$BASELINE_FILE まで）"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $UPGRADE_DB"
psql "$ADMIN_URL" -q -c "CREATE DATABASE $UPGRADE_DB"

APPLIED_BASE=0
for file in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do
  name=$(basename "$file")
  version=$(printf '%s' "$name" | cut -c1-4)
  [ "$version" -gt "$BASELINE" ] 2>/dev/null && continue
  psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 -f "$file" > /dev/null
  APPLIED_BASE=$((APPLIED_BASE + 1))
done
echo "  $APPLIED_BASE 件"

echo 'その版の代表的なデータを入れます'
psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 -f "$FIXTURE" > /dev/null

echo "起点より後を、1 件ずつ順に当てます"
APPLIED_AFTER=0
for file in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do
  name=$(basename "$file")
  version=$(printf '%s' "$name" | cut -c1-4)
  [ "$version" -gt "$BASELINE" ] 2>/dev/null || continue
  printf '  %s' "$name"
  if ! psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 -f "$file" > /dev/null 2>"$ROOT/.upgrade-error"; then
    printf ' … 当てられません\n'
    cat "$ROOT/.upgrade-error" >&2
    rm -f "$ROOT/.upgrade-error"
    exit 1
  fi
  printf ' … OK\n'
  APPLIED_AFTER=$((APPLIED_AFTER + 1))
done
rm -f "$ROOT/.upgrade-error"

if [ "$APPLIED_AFTER" -eq 0 ]; then
  echo "起点より後の migration がありません。起点が最新に追い付いています。" >&2
  exit 1
fi

# 当てたあとも、入れた行が残っていることを見る。
# 消してから作り直す migration は、当てるだけなら通ってしまう。
#
# 見るのは、あとの版が列を足したり参照したりする側。
# 数が合わなければ、移行の途中でどこかが行を落としている。
echo '入れたデータが残っていることを見ます'
CHECKS="attendance_events=2 attendance_calculations=1 daily_attendance_requests=1
  monthly_closings=1 leave_types=1 work_schedules=1 webhook_endpoints=1
  webhook_outbox=1 webhook_deliveries=1 employees=1 devices=1 audit_logs=1"
for check in $CHECKS; do
  table=$(printf '%s' "$check" | cut -d= -f1)
  expected=$(printf '%s' "$check" | cut -d= -f2)
  actual=$(psql "$UPGRADE_URL" -At -c "SELECT count(*) FROM $table")
  if [ "$actual" != "$expected" ]; then
    echo "  NG $table は $expected 件のはずが $actual 件です" >&2
    exit 1
  fi
done

# あとの版が足した表と列が、実際に使える形になっているかを見る。
# 当てられただけでは、既存の行と噛み合っているかは分からない。
echo 'あとの版が足したものを使えることを見ます'
psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 <<'SQL' > /dev/null
-- 勤務区分と計算規則の版（0026）
INSERT INTO work_categories
  (workspace_id, code, internal_name, display_name, category_type, effective_from)
SELECT id, 'DAY', '通常勤務', '日勤', 'working_day', '2026-05-01'
  FROM workspaces WHERE slug = 'upgrade';
-- 0026 は既存の calculation_rule_sets を版として写す。写せていれば行がある。
SELECT 1 / count(*) FROM calculation_rule_versions;

-- 労働形態（0027）
INSERT INTO labor_system_assignments (workspace_id, employee_id, system_type, effective_from)
SELECT workspace_id, id, 'normal', '2026-05-01' FROM employees;

-- 法定の区分（0028）。既存の日へ、新しい版として書き込めること。
-- 計算は追記のみ。書き換えではなく、版を重ねて確かめる。
INSERT INTO attendance_calculations
  (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
   attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
   within_schedule_minutes, outside_schedule_minutes, night_minutes,
   non_working_day_minutes, leave_minutes, absence_minutes,
   legal_inside_overtime_minutes, legal_overtime_minutes, basis)
SELECT workspace_id, employee_id, business_date, version + 1, 'after-upgrade', 'upgraded',
       540, 540, 0, 480, 480, 60, 0, 0, 0, 0, 480, 60, '{}'::jsonb
  FROM attendance_calculations;

-- 休暇の台帳（0029）
INSERT INTO leave_ledger_entries
  (workspace_id, employee_id, leave_type_id, entry_type, minutes, effective_on)
SELECT e.workspace_id, e.id, l.id, 'grant', 480, '2026-05-01'
  FROM employees e JOIN leave_types l ON l.workspace_id = e.workspace_id;

-- 申請種別と段階承認（0030）
INSERT INTO request_types (workspace_id, code, name, category, approval_steps, requires_leave_type)
SELECT id, 'LEAVE', '休暇', 'leave', 2, true FROM workspaces WHERE slug = 'upgrade';
INSERT INTO employee_requests
  (workspace_id, request_type_id, employee_id, total_steps, business_date)
SELECT t.workspace_id, t.id, e.id, t.approval_steps, '2026-05-01'
  FROM request_types t JOIN employees e ON e.workspace_id = t.workspace_id;

-- 締めたときの集計（0031）
INSERT INTO monthly_closing_snapshots
  (workspace_id, employee_id, period, sequence, counted_days, day_versions,
   attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
   within_schedule_minutes, outside_schedule_minutes, night_minutes,
   non_working_day_minutes, leave_minutes, absence_minutes, worked_days, leave_days)
SELECT workspace_id, id, '2026-04-01', 1, 1, '{}'::jsonb,
       540, 540, 0, 480, 480, 60, 0, 0, 0, 0, 1, 0
  FROM employees;

-- 送信の再試行（0032）。既存の送信待ちが、初期値のまま使えること。
UPDATE webhook_outbox SET attempts = attempts + 1;
SQL

echo "起点 $BASELINE から $APPLIED_AFTER 件を当てられました（データは残っています）"
