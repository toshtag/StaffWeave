#!/bin/sh
# バックアップからデータベースを復元する。
#
#   pnpm restore backups/staffweave-20260401-120000.dump
#
# 復元先の既存データは失われます。実行前に対象を確認してください。
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

printf '%s のデータをすべて置き換えます。続けますか？ [y/N] ' "$DATABASE"
read -r answer
case "$answer" in
  y | Y) ;;
  *)
    echo "中止しました。"
    exit 1
    ;;
esac

docker exec -i "$CONTAINER" pg_restore \
  --username "$USER_NAME" \
  --dbname "$DATABASE" \
  --clean \
  --if-exists \
  --no-owner < "$INPUT"

echo "復元しました: $INPUT"
echo "アプリケーションを起動する前に pnpm db:status で適用状況を確認してください。"
