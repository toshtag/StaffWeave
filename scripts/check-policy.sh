#!/bin/sh
# リポジトリの決めごとが守られているかを機械的に確かめる。
#
#   pnpm check:policy
#
# ここで見るのは、レビューで見落としやすく、後から直すと影響が大きいものだけ。
# 文体や設計の良し悪しは対象にしない。
set -eu

FAILED=0

fail() {
  printf '  NG %s\n' "$1"
  FAILED=1
}

pass() {
  printf '  OK %s\n' "$1"
}

# 検査自身が例として持つ文字列を拾わないよう、この脚本は対象から外す。
TRACKED=$(git ls-files | grep -v '^scripts/check-policy.sh$')

echo '名称の一貫性'
# 開発方針の文書は「変形しない」という規則の説明として変形例を含むため、対象から外す。
NAME_TARGETS=$(printf '%s\n' "$TRACKED" | grep -v '^docs/development-policy.md$')
if printf '%s\n' "$NAME_TARGETS" | xargs grep -l -e 'staff-weave' -e 'StaffWeave' 2>/dev/null | grep . > /dev/null; then
  printf '%s\n' "$NAME_TARGETS" | xargs grep -n -e 'staff-weave' -e 'StaffWeave' 2>/dev/null | head -20
  fail '正式名称 staffweave が変形しています'
else
  pass '正式名称が staffweave で統一されています'
fi

echo '秘密情報'
if printf '%s\n' "$TRACKED" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example' | grep . > /dev/null; then
  fail '.env がコミットされています'
else
  pass '.env はコミットされていません'
fi

if printf '%s\n' "$TRACKED" | grep -E 'staffweave-agent\.json$' | grep . > /dev/null; then
  fail '端末の資格情報ファイルがコミットされています'
else
  pass '端末の資格情報はコミットされていません'
fi

if printf '%s\n' "$TRACKED" | xargs grep -l 'BEGIN .*PRIVATE KEY' 2>/dev/null | grep . > /dev/null; then
  printf '%s\n' "$TRACKED" | xargs grep -ln 'BEGIN .*PRIVATE KEY' 2>/dev/null | head -10
  fail '秘密鍵らしき内容が含まれています'
else
  pass '秘密鍵は含まれていません'
fi

# 実際に発行された API キーの形（sw_ + 16 進 8 桁 + 秘密）。
if printf '%s\n' "$TRACKED" | xargs grep -lE 'sw_[0-9a-f]{8}_[A-Za-z0-9_-]{16,}' 2>/dev/null | grep . > /dev/null; then
  fail 'API キーらしき値が含まれています'
else
  pass 'API キーらしき値は含まれていません'
fi

echo '生成ツール由来の定型文'
if printf '%s\n' "$TRACKED" | xargs grep -liE 'co-authored-by: *claude|generated with \[?claude' 2>/dev/null | grep . > /dev/null; then
  fail '生成ツール由来の定型文が含まれています'
else
  pass '生成ツール由来の定型文はありません'
fi

echo 'マイグレーション'
DUPLICATES=$(git ls-files 'packages/db/migrations/*.sql' | sed 's#.*/##' | cut -c1-4 | sort | uniq -d)
if [ -n "$DUPLICATES" ]; then
  printf '  重複した版番号: %s\n' "$DUPLICATES"
  fail 'マイグレーションの版番号が重複しています'
else
  pass 'マイグレーションの版番号は一意です'
fi

if git ls-files 'packages/db/migrations/*.sql' | sed 's#.*/##' | grep -vE '^[0-9]{4}_[a-z0-9_]+\.sql$' | grep . > /dev/null; then
  fail 'マイグレーションのファイル名が規約に合いません'
else
  pass 'マイグレーションのファイル名は規約どおりです'
fi

echo 'ドメイン層の独立'
if git ls-files 'packages/domain/src/**/*.ts' | xargs grep -nE "from '(hono|react|pg|@staffweave/(api|db|web|contracts))" 2>/dev/null | grep . > /dev/null; then
  git ls-files 'packages/domain/src/**/*.ts' | xargs grep -nE "from '(hono|react|pg|@staffweave/(api|db|web|contracts))" 2>/dev/null | head -10
  fail 'ドメイン層がフレームワークや上位パッケージへ依存しています'
else
  pass 'ドメイン層は独立しています'
fi

if [ "$FAILED" -ne 0 ]; then
  echo ''
  echo 'リポジトリの決めごとに反する箇所があります。'
  exit 1
fi

echo ''
echo 'すべての検査を通過しました。'
