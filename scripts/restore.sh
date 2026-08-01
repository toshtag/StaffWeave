#!/bin/sh
# バックアップからデータベースを復元する。
#
#   pnpm restore backups/staffweave-20260401-120000.dump
#
# 復元先の既存データは失われます。実行前に対象を確認してください。
#
# 復元は 1 つのトランザクションで行います。途中で失敗した場合、
# データベースは実行前と同じ状態に戻ります。削除だけが済んだ状態にはなりません。
set -eu

INPUT="${1:-}"
if [ -z "$INPUT" ]; then
  echo "復元するファイルを指定してください。" >&2
  exit 1
fi
if [ ! -f "$INPUT" ]; then
  echo "ファイルが見つかりません: $INPUT" >&2
  exit 1
fi

CONTAINER="${STAFFWEAVE_DB_CONTAINER:-staffweave-db}"
DATABASE="${STAFFWEAVE_DB_NAME:-staffweave}"
USER_NAME="${STAFFWEAVE_DB_USER:-staffweave}"

# 稼働中の復元は、進行中のトランザクションと衝突する。
# 打刻イベントは追記専用で復元できないため、その時間帯の記録が失われうる。
# -i を付けると標準入力を読み取ってしまい、後の確認入力が届かなくなる。
CONNECTIONS=$(docker exec "$CONTAINER" psql \
  --username "$USER_NAME" --dbname "$DATABASE" --tuples-only --no-align \
  --command "SELECT count(*) FROM pg_stat_activity
             WHERE datname = current_database() AND pid <> pg_backend_pid()")
if [ "$CONNECTIONS" -gt 0 ]; then
  echo "$DATABASE へ $CONNECTIONS 件の接続が残っています。" >&2
  echo "アプリケーションと送信ワーカーを止めてから、もう一度実行してください。" >&2
  echo "  docker compose --profile app stop app webhook-worker" >&2
  exit 1
fi

# 復元先を取り違えないよう、名前を打ち込ませる。y の一文字では実行しない。
echo "復元先: $DATABASE（コンテナ $CONTAINER）"
echo "復元元: $INPUT"
echo "$DATABASE のデータはすべて置き換わります。"
printf '続けるにはデータベース名を入力してください: '
read -r answer
if [ "$answer" != "$DATABASE" ]; then
  echo "入力が一致しません。中止しました。"
  exit 1
fi

# 復元前の状態を残す。取り違えたファイルで実行しても、戻せる先を用意しておく。
SAFETY="backups/before-restore-$(date +%Y%m%d-%H%M%S).dump"
mkdir -p "$(dirname "$SAFETY")"
docker exec "$CONTAINER" pg_dump --username "$USER_NAME" --format=custom "$DATABASE" > "$SAFETY"
echo "復元前の状態を保存しました: $SAFETY"

# --single-transaction は --clean による削除と投入を 1 つのトランザクションに収める。
# 途中で失敗すれば削除も取り消され、実行前の状態が残る。
docker exec -i "$CONTAINER" pg_restore \
  --username "$USER_NAME" \
  --dbname "$DATABASE" \
  --single-transaction \
  --exit-on-error \
  --clean \
  --if-exists \
  --no-owner < "$INPUT"

echo "復元しました: $INPUT"
echo "アプリケーションを起動する前に pnpm db:status で適用状況を確認してください。"
