#!/bin/sh
# データベース全体をファイルへ書き出す。
#
#   pnpm backup                 backups/staffweave-<日時>.dump へ保存
#   pnpm backup path/to/file    保存先を指定
#
# 出力にはすべての業務データが含まれます。保管場所の扱いに注意してください。
# 所有者だけが読める権限で作りますが、持ち出す場合は暗号化してください。
# IC カードの指紋鍵（CARD_FINGERPRINT_KEY）はここに含まれません。
# 復元後にカード機能を使うには、同じ鍵を環境変数へ設定する必要があります。
set -eu

. "$(dirname "$0")/secure-dump.sh"

OUTPUT="${1:-backups/staffweave-$(date +%Y%m%d-%H%M%S).dump}"
CONTAINER="${STAFFWEAVE_DB_CONTAINER:-staffweave-db}"
DATABASE="${STAFFWEAVE_DB_NAME:-staffweave}"
USER_NAME="${STAFFWEAVE_DB_USER:-staffweave}"

secure_dump "$OUTPUT" "$CONTAINER" "$USER_NAME" "$DATABASE"

echo "バックアップを作成しました: $OUTPUT"
