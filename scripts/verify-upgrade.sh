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
# ここでは「1 つ前の版まで流し、demo のデータを入れ、残りを当てる」を行う。
# 当てられなければ、その migration は既存の利用者を止める。
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

url_for() {
  printf '%s' "$BASE_URL" | sed "s#/[^/?]*\(?.*\)\{0,1\}\$#/$1#"
}

ADMIN_URL=$(url_for postgres)
UPGRADE_URL=$(url_for "$UPGRADE_DB")

cleanup() {
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $UPGRADE_DB" > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# いちばん新しい migration を、あとから足すぶんとして分ける。
# 「直前の版で動いていた利用者」を作るのが目的なので、境目はここでよい。
LATEST=$(ls "$MIGRATIONS" | grep -E '^[0-9]{4}_.*\.sql$' | sort | tail -1)
if [ -z "$LATEST" ]; then
  echo 'migration が見つかりません。' >&2
  exit 1
fi

echo "1 つ前の版まで流します（あとから当てるのは $LATEST）"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $UPGRADE_DB"
psql "$ADMIN_URL" -q -c "CREATE DATABASE $UPGRADE_DB"

for file in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do
  name=$(basename "$file")
  [ "$name" = "$LATEST" ] && continue
  psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 -f "$file" > /dev/null
done

echo 'その版のうちに、業務のデータを入れます'
# demo の投入は最新の版を前提にしうるため使わない。
# ここで要るのは「古い版の形のまま入っている行」なので、直に入れる。
psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO workspaces (slug, name, time_zone) VALUES ('upgrade', '移行の確認', 'Asia/Tokyo');
INSERT INTO organizations (workspace_id, code, name)
  SELECT id, 'HQ', '本社' FROM workspaces WHERE slug = 'upgrade';
INSERT INTO users (workspace_id, email, password_hash, display_name)
  SELECT id, 'upgrade@example.test', 'x', '移行 太郎' FROM workspaces WHERE slug = 'upgrade';
INSERT INTO employees (workspace_id, organization_id, user_id, employee_number, display_name)
  SELECT o.workspace_id, o.id, u.id, 'E001', '移行 太郎'
    FROM organizations o JOIN users u ON u.workspace_id = o.workspace_id;
INSERT INTO attendance_events
  (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
  SELECT workspace_id, id, 'clock_in', now(), current_date, 'web', 'upgrade-check-1'
    FROM employees;
SQL

echo "残りを当てます: $LATEST"
psql "$UPGRADE_URL" -q -v ON_ERROR_STOP=1 -f "$MIGRATIONS/$LATEST" > /dev/null

# 当てたあとも、入れた行が残っていることを見る。
# 消してから作り直す migration は、当てるだけなら通ってしまう。
REMAINING=$(psql "$UPGRADE_URL" -At -c "SELECT count(*) FROM attendance_events")
if [ "$REMAINING" != "1" ]; then
  echo "当てたあとに打刻が残っていません（$REMAINING 件）。" >&2
  exit 1
fi

echo "既にデータのあるデータベースへ $LATEST を当てられました（打刻は残っています）"
