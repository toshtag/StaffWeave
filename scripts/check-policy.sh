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

echo '認可契約'
# 「閲覧範囲が空ならワークスペース全体」という旧設計の説明。
# 空配列は「管理対象なし」を意味し、全体の閲覧可否はロールが決める。
# 説明が実装と食い違うと、次に読む人が同じ穴を掘り直す。
# 表現を網羅できるわけではない。過去に実際に書かれたものを覚えさせ、同じ形の再発だけを止める。
OLD_SCOPE_PATTERN='空なら制限なし|空ならワークスペース全体|行が無ければワークスペース全体|行がなければワークスペース全体|行を持たない利用者はワークスペース全体|閲覧範囲を持たない管理者には全員|閲覧範囲を持たない管理者は誰でも|閲覧範囲を持たない利用者はワークスペース全体'
# 例外は 2 つだけ。どちらも「旧説明を書き写した箇所」ではなく、
# 旧説明そのものを対象として扱うファイルであるため除く。
#
#   0012 マイグレーション: 適用済みでチェックサム保護のため書き換えられない歴史的記録。
#   contracts の契約テスト: 旧表現が生成 OpenAPI に現れないことを確かめるための列挙。
#
# この脚本自身も、検査の対象語をそのまま持つため冒頭で TRACKED から外している。
HISTORICAL_SCOPE_FILE='packages/db/migrations/0012_create_assignments_and_scopes.sql'
CONTRACT_TEST_FILE='packages/contracts/src/contracts.test.ts'

SCOPE_TARGETS=$(printf '%s\n' "$TRACKED" \
  | grep -v "^$HISTORICAL_SCOPE_FILE\$" \
  | grep -v "^$CONTRACT_TEST_FILE\$")
if printf '%s\n' "$SCOPE_TARGETS" | xargs grep -lE "$OLD_SCOPE_PATTERN" 2>/dev/null | grep . > /dev/null; then
  printf '%s\n' "$SCOPE_TARGETS" | xargs grep -nE "$OLD_SCOPE_PATTERN" 2>/dev/null | head -20
  fail '旧い認可契約（閲覧範囲が空なら全件）の説明が残っています'
else
  pass '既知の旧認可契約の表現は残っていません'
fi

# 例外の範囲が知らないうちに広がらないよう、例外の側も件数を固定する。
check_scope_exception() {
  expected=$2
  actual=$(grep -cE "$OLD_SCOPE_PATTERN" "$1" 2>/dev/null || echo 0)
  if [ "$actual" -eq "$expected" ]; then
    pass "$3"
  else
    printf '  %s の検出件数: %s（期待値 %s）\n' "$1" "$actual" "$expected"
    fail '例外として認めた旧説明の件数が変わっています'
  fi
}

check_scope_exception "$HISTORICAL_SCOPE_FILE" 1 '歴史的な旧説明は 0012 マイグレーションの 1 件だけです'
check_scope_exception "$CONTRACT_TEST_FILE" 4 '契約テストが列挙する旧表現は 4 件のままです'

echo 'ライセンスとリリース判定'
# ライセンスは法的な表示、README、決定の記録の 3 か所に現れる。
# どれか 1 つだけが変わった状態を作れないようにする。
if grep -q 'MIT License' LICENSE; then
  pass 'LICENSE が MIT License です'
else
  fail 'LICENSE が MIT License ではありません'
fi

if grep -q 'MIT License' README.md; then
  pass 'README がライセンスを MIT License として示しています'
else
  fail 'README のライセンス表記が MIT License ではありません'
fi

LICENSE_DECISION='docs/decisions/0001-mit-license.md'
if [ -f "$LICENSE_DECISION" ]; then
  pass 'ライセンスの決定が記録されています'
else
  fail "ライセンスの決定の記録がありません: $LICENSE_DECISION"
fi

# 判断待ちの表現が残っていれば、決定と文書が食い違っている。
if grep -qE 'ライセンス方針が確定している \| *\*\*未\*\*|ライセンス方針の決定だけ|ライセンス.*判断待ち' \
  README.md docs/roadmap.md 2>/dev/null; then
  fail 'ライセンスを判断待ちとする記述が残っています'
else
  pass 'ライセンスを判断待ちとする記述はありません'
fi

# 判定は日付と基準コミットを持つ記録が正本。要約だけを残さない。
if ls docs/release-readiness/[0-9]*.md > /dev/null 2>&1; then
  pass '正式リリース判定の記録があります'
else
  fail '正式リリース判定の記録がありません: docs/release-readiness/'
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

echo 'パッケージの依存方向'
# 依存してよい相手をここで固定する。文書の依存図と同じ内容を機械的に確かめる。
# api だけは、端末と外部連携の取り決めを検証するため agent と connector を試験用に使う。
DEPENDENCY_RULES='domain:
db:
contracts:domain
web:contracts,domain
agent:contracts,domain
connector:contracts,domain
api:contracts,db,domain,agent,connector'

for RULE in $DEPENDENCY_RULES; do
  PACKAGE=${RULE%%:*}
  ALLOWED=${RULE#*:}
  MANIFEST="packages/$PACKAGE/package.json"
  [ -f "$MANIFEST" ] || continue

  ACTUAL=$(grep -o '"@staffweave/[a-z]*"' "$MANIFEST" | sed 's/"@staffweave\///; s/"//' | sort -u)
  for DEPENDENCY in $ACTUAL; do
    [ "$DEPENDENCY" = "$PACKAGE" ] && continue
    case ",$ALLOWED," in
      *",$DEPENDENCY,"*) ;;
      *) fail "$PACKAGE が $DEPENDENCY へ依存しています（docs/module-boundaries.md の依存方向に反します）" ;;
    esac
  done
done
if [ "$FAILED" -eq 0 ]; then
  pass '依存方向は文書のとおりです'
fi

if [ "$FAILED" -ne 0 ]; then
  echo ''
  echo 'リポジトリの決めごとに反する箇所があります。'
  exit 1
fi

echo ''
echo 'すべての検査を通過しました。'
