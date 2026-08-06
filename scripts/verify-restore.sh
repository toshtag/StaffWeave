#!/bin/sh
# バックアップから復元したものが、元と同じ中身になることを確かめる。
#
#   DATABASE_URL=postgres://... ./scripts/verify-restore.sh
#
# 権限の付き方は scripts/backup.sh 側の検査で見ている。ここで見るのは中身。
# 「取れた」「戻せた」だけでは足りない。戻したものが元と違っていても、
# 戻せた時点では誰も気付かない。行の数と中身まで突き合わせる。
#
# 運用の backup.sh / restore.sh は docker exec を通す。ここは接続文字列だけで動かす。
# CI の PostgreSQL は別のコンテナとして立つため、docker exec では届かない。
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

if ! command -v pg_dump > /dev/null 2>&1 || ! command -v psql > /dev/null 2>&1; then
  echo 'pg_dump と psql が要ります（postgresql-client）。' >&2
  exit 1
fi

BASE_URL="${DATABASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  echo 'DATABASE_URL を設定してください。' >&2
  exit 1
fi

SOURCE_DB="staffweave_restore_source"
TARGET_DB="staffweave_restore_target"

# 接続文字列のうち、データベース名だけを差し替える。
url_for() {
  printf '%s' "$BASE_URL" | sed "s#/[^/?]*\(?.*\)\{0,1\}\$#/$1#"
}

ADMIN_URL=$(url_for postgres)
SOURCE_URL=$(url_for "$SOURCE_DB")
TARGET_URL=$(url_for "$TARGET_DB")

WORK=$(mktemp -d)
cleanup() {
  rm -rf "$WORK"
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SOURCE_DB" > /dev/null 2>&1 || true
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $TARGET_DB" > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo '複製元を用意します'
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SOURCE_DB"
psql "$ADMIN_URL" -q -c "CREATE DATABASE $SOURCE_DB"
DATABASE_URL="$SOURCE_URL" pnpm --filter @staffweave/db migrate > /dev/null
DATABASE_URL="$SOURCE_URL" pnpm --filter @staffweave/api seed:demo > /dev/null

# 追記のみのテーブルへも行を入れておく。復元の経路で引っかかるのは、
# 書き換えを拒む仕掛けが付いたテーブルであることが多い。
psql "$SOURCE_URL" -q <<'SQL'
INSERT INTO attendance_events
  (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
SELECT e.workspace_id, e.id, 'clock_in', now(), current_date, 'web', 'verify-restore-1'
  FROM employees e LIMIT 1;
INSERT INTO audit_logs (workspace_id, actor_kind, action, target_type, summary)
SELECT id, 'system', 'restore.verified', 'workspace', '復元の確認' FROM workspaces LIMIT 1;
SQL

echo '書き出します'
pg_dump --format=custom --file "$WORK/source.dump" "$SOURCE_URL"

echo '別のデータベースへ戻します'
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $TARGET_DB"
psql "$ADMIN_URL" -q -c "CREATE DATABASE $TARGET_DB"
pg_restore --dbname "$TARGET_URL" --single-transaction "$WORK/source.dump"

# テーブルごとに、行の数と中身の要約を並べる。
# 中身まで見ないと、行の数が同じで値だけ違う復元を見逃す。
summarize() {
  psql "$1" -At -F '|' <<'SQL'
SELECT table_name,
       (xpath('/row/count/text()',
              query_to_xml(format('SELECT count(*) AS count FROM %I', table_name),
                           false, true, '')))[1]::text::bigint AS rows,
       (xpath('/row/digest/text()',
              query_to_xml(
                format('SELECT md5(coalesce(string_agg(t::text, E''\n'' ORDER BY t::text), '''')) AS digest FROM %I t', table_name),
                false, true, '')))[1]::text AS digest
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
 ORDER BY table_name
SQL
}

summarize "$SOURCE_URL" > "$WORK/source.txt"
summarize "$TARGET_URL" > "$WORK/target.txt"

if ! diff -u "$WORK/source.txt" "$WORK/target.txt" > "$WORK/diff.txt"; then
  echo '復元したものが元と違います:' >&2
  cat "$WORK/diff.txt" >&2
  exit 1
fi

TABLES=$(wc -l < "$WORK/source.txt" | tr -d ' ')
if [ "$TABLES" -lt 20 ]; then
  echo "比べたテーブルが少なすぎます（$TABLES）。復元の確認になっていません。" >&2
  exit 1
fi

echo "復元したものは元と同じです（テーブル $TABLES、行の数と中身の要約が一致）"
