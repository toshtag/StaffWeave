#!/bin/sh
# 依存の既知脆弱性を検査する。
#
#   pnpm check:audit
#
# moderate 以上の勧告が 1 件でもあれば失敗させる。
# すぐに直せないものは scripts/audit-exceptions.txt へ、理由と期限つきで書く。
# 期限を過ぎた例外は、勧告が残っているかどうかに関わらず失敗させる。
# 期限のない見送りを作らないため。
set -eu

EXCEPTIONS_FILE="scripts/audit-exceptions.txt"
LEVEL=moderate
TODAY=$(date +%Y-%m-%d)

FAILED=0
IGNORES=""

echo '例外'
if [ -f "$EXCEPTIONS_FILE" ]; then
  while IFS=' ' read -r ADVISORY EXPIRES REASON; do
    case "${ADVISORY:-}" in
      '' | '#'*) continue ;;
    esac

    if [ -z "${EXPIRES:-}" ] || [ -z "${REASON:-}" ]; then
      printf '  NG 書き方が違います: %s（<勧告 ID> <期限 YYYY-MM-DD> <理由>）\n' "$ADVISORY"
      FAILED=1
      continue
    fi

    if [ "$EXPIRES" \< "$TODAY" ]; then
      printf '  NG 例外の期限が切れています: %s（期限 %s / %s）\n' "$ADVISORY" "$EXPIRES" "$REASON"
      FAILED=1
      continue
    fi

    printf '  -- %s は %s まで見送り（%s）\n' "$ADVISORY" "$EXPIRES" "$REASON"
    IGNORES="$IGNORES --ignore $ADVISORY"
  done < "$EXCEPTIONS_FILE"
fi

if [ "$IGNORES" = "" ]; then
  echo '  OK 見送っている勧告はありません'
fi

echo '依存の脆弱性'
# 引用しないのは、複数の --ignore へ分けて渡すため。
# shellcheck disable=SC2086
if pnpm audit --audit-level "$LEVEL" $IGNORES; then
  printf '  OK %s 以上の勧告はありません\n' "$LEVEL"
else
  printf '  NG %s 以上の勧告があります\n' "$LEVEL"
  echo '     直せない場合は scripts/audit-exceptions.txt へ理由と期限を書いてください。'
  FAILED=1
fi

echo ''
if [ "$FAILED" -eq 0 ]; then
  echo 'すべての検査を通過しました。'
else
  echo '検査に失敗しました。'
  exit 1
fi
