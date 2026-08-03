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
# 開発方針の文書は「使わない」という規則の説明として、使わない形そのものを含むため対象から外す。
NAME_TARGETS=$(printf '%s\n' "$TRACKED" | grep -v '^docs/development/policy.md$')
if printf '%s\n' "$NAME_TARGETS" | xargs grep -l 'staff-weave' 2>/dev/null | grep . > /dev/null; then
  printf '%s\n' "$NAME_TARGETS" | xargs grep -n 'staff-weave' 2>/dev/null | head -20
  fail '名称に staff-weave の形が使われています'
else
  pass '名称に staff-weave の形はありません'
fi

# 読ませる名前は StaffWeave、機械が読む名前は staffweave。
# 見るのは文書の本文だけにする。設定と実行用のコードには、接続情報やコンテナの名前として
# 小文字がそのまま並ぶため、同じ規則では区別できない。
#
# 識別子は必ず何かと繋がった形で現れる（`@staffweave/*`、`staffweave-db`、`x-staffweave-`、
# `staffweave_e2e`、`staffweave.example.com`、コード表記の前後の `` ` ``）。
# 前後に繋がりを持たない出現だけを、本文へ書いた名前として拾う。
PROSE_NAME='(^|[^`@/_a-zA-Z-])staffweave([^`@a-zA-Z0-9/_.:-]|$)'
PROSE_TARGETS=$(printf '%s\n' "$NAME_TARGETS" | grep '\.md$')
if printf '%s\n' "$PROSE_TARGETS" | xargs grep -lE "$PROSE_NAME" 2>/dev/null | grep . > /dev/null; then
  printf '%s\n' "$PROSE_TARGETS" | xargs grep -nE "$PROSE_NAME" 2>/dev/null | head -20
  fail '文書の本文の名前が StaffWeave になっていません'
else
  pass '文書の本文の名前は StaffWeave で揃っています'
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

echo 'ライセンス'
# ライセンスは法的な表示、README、決定の記録の 3 か所に現れる。
# どれか 1 つだけが変わった状態を作れないようにする。
if grep -q 'MIT License' LICENSE; then
  pass 'LICENSE が MIT License です'
else
  fail 'LICENSE が MIT License ではありません'
fi

# 名義は決定 0002 で実在の権利者へ改めた。いない集団を指す形へ戻ると、
# 再配布を受け取った側が、誰の許諾で使っているのかを辿れなくなる。
if grep -qE '^Copyright \(c\) [0-9]{4} Pocket \(@toshtag\)$' LICENSE; then
  pass 'LICENSE の著作権表示が権利者の名義です'
else
  grep -n 'Copyright' LICENSE
  fail 'LICENSE の著作権表示が権利者の名義ではありません'
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
if printf '%s\n' "$PROSE_TARGETS" \
  | xargs grep -qE 'ライセンス方針が確定している \| *\*\*未\*\*|ライセンス方針の決定だけ|ライセンス.*判断待ち' 2>/dev/null; then
  fail 'ライセンスを判断待ちとする記述が残っています'
else
  pass 'ライセンスを判断待ちとする記述はありません'
fi

echo 'SBOM'
for required in docs/security/sbom.md scripts/generate-sbom.sh scripts/verify-sbom.mjs; do
  if [ -f "$required" ]; then
    pass "$required があります"
  else
    fail "$required がありません"
  fi
done

# 生成物は commit ごとに作り直す。追跡すると、古い構成が新しい版の説明として残る。
if printf '%s\n' "$TRACKED" | grep -qE '\.cdx\.json'; then
  fail 'SBOM の生成物が Git で追跡されています'
else
  pass 'SBOM の生成物は追跡されていません'
fi

# 通常の検証で Docker と外部の道具を必須にしない。オフラインで確かめられなくなる。
if grep -E '"verify"' package.json | grep -q 'sbom'; then
  fail 'pnpm verify が SBOM の生成を巻き込んでいます'
else
  pass 'pnpm verify は SBOM の生成を必要としません'
fi

# 新しく足した Action は完全なコミット SHA で固定する。
# tag は同じ名前のまま指す先が変わりうるため、版として当てにできない。
SBOM_JOB=$(sed -n '/^  sbom:/,$p' .github/workflows/ci.yml)
UNPINNED=$(printf '%s\n' "$SBOM_JOB" | grep -E 'uses:' | grep -vE 'uses: [^@]+@[0-9a-f]{40}( |$)' || true)
if [ -n "$UNPINNED" ]; then
  printf '%s\n' "$UNPINNED"
  fail 'SBOM のジョブに、コミット SHA で固定していない Action があります'
else
  pass 'SBOM のジョブの Action はコミット SHA で固定されています'
fi

echo '依存の版'
# 実行環境の major は .nvmrc を正本とする。
NODE_MAJOR=$(sed -n '1s/^v\{0,1\}\([0-9][0-9]*\).*$/\1/p' .nvmrc)
if [ -z "$NODE_MAJOR" ]; then
  fail '.nvmrc から Node の major を読めません'
  NODE_MAJOR=0
fi

# 配布するコンテナが別の major で動くと、CI で通ったものが配布物では動かない。
FROM_LINES=$(grep -E '^FROM node:' docker/api.Dockerfile)
if printf '%s\n' "$FROM_LINES" | grep -qvE "^FROM node:${NODE_MAJOR}-"; then
  printf '%s\n' "$FROM_LINES"
  fail "コンテナの Node が .nvmrc（${NODE_MAJOR} 系）と違います"
else
  pass "コンテナの Node は .nvmrc と同じ ${NODE_MAJOR} 系です"
fi

# 依存の名前を受け取り、宣言している版の範囲を重複なく返す。
# 対象は package.json の依存の項目だけで、scripts の中の同名の語は拾わない。
declared_ranges() {
  git ls-files 'package.json' 'packages/*/package.json' \
    | xargs grep -h "\"$1\": \"" 2>/dev/null \
    | sed 's/.*: *"\([^"]*\)".*/\1/' \
    | sort -u
}

# 同じ道具をパッケージごとに別の版で宣言すると、lockfile を作り直したときに
# どのパッケージが古い版を引くかが変わる。宣言の側を 1 つに保つ。
for dep in '@types/node' tsx typescript vitest; do
  RANGES=$(declared_ranges "$dep")
  if [ "$(printf '%s\n' "$RANGES" | grep -c .)" -eq 1 ]; then
    pass "$dep の版指定はパッケージ間で揃っています（$RANGES）"
  else
    printf '  %s: %s\n' "$dep" "$(printf '%s ' $RANGES)"
    fail "$dep の版指定がパッケージ間で食い違っています"
  fi
done

# 型定義の major が実行環境より先へ行くと、実行環境に無い API が型検査だけ通る。
TYPES_NODE=$(declared_ranges '@types/node')
case "$TYPES_NODE" in
  "^${NODE_MAJOR}."*)
    pass "@types/node の major が実行環境（Node ${NODE_MAJOR}）と一致しています"
    ;;
  *)
    printf '  @types/node: %s / .nvmrc: %s\n' "$(printf '%s ' $TYPES_NODE)" "$NODE_MAJOR"
    fail '@types/node の major が実行環境と一致していません'
    ;;
esac

# 開発機と CI が別の major で動くと、ローカルで通った SQL が CI では別の版で走る。
# tag は必ず major を含む形で書く。latest のような動く tag は、版として当てにできない。
PG_TAGS=$(grep -hoE 'image: postgres:[^ ]+' docker-compose.yml .github/workflows/ci.yml \
  | sed 's/^image: postgres://' \
  | sort -u)
if [ "$(printf '%s\n' "$PG_TAGS" | grep -c .)" -ne 1 ]; then
  printf '  postgres: %s\n' "$(printf '%s ' $PG_TAGS)"
  fail 'PostgreSQL の版が compose と CI で食い違っています'
elif ! printf '%s' "$PG_TAGS" | grep -qE '^[0-9]+-[a-z][a-z0-9]*$'; then
  printf '  postgres: %s\n' "$PG_TAGS"
  fail 'PostgreSQL の tag が「major-基盤」の形になっていません'
else
  pass "PostgreSQL の版が compose と CI で揃っています（$PG_TAGS）"
fi

# 並びは libc ではなく builtin プロバイダで決める。ここが抜けたまま初期化すると、
# 新しく作るクラスタだけ OS のロケールに従い、既存の索引と並びが変わる。
# 値は compose と CI で同じにする。折り返しの違いを無視して、指定の集合で比べる。
initdb_options() {
  awk '
    /POSTGRES_INITDB_ARGS:/ { inside = 1 }
    inside {
      n = gsub(/--[a-z][a-z-]*=[^ "'"'"']+/, "&\n")
      if (n == 0 && !/POSTGRES_INITDB_ARGS:/) { inside = 0; next }
      for (i = 1; i <= NF; i++) if ($i ~ /^--[a-z]/) print $i
    }
  ' "$1" | sort -u
}
COMPOSE_INITDB=$(initdb_options docker-compose.yml)
CI_INITDB=$(initdb_options .github/workflows/ci.yml)
if [ -z "$COMPOSE_INITDB" ]; then
  fail 'compose が POSTGRES_INITDB_ARGS を指定していません'
elif [ "$COMPOSE_INITDB" != "$CI_INITDB" ]; then
  printf '  compose: %s\n' "$(printf '%s ' $COMPOSE_INITDB)"
  printf '  CI:      %s\n' "$(printf '%s ' $CI_INITDB)"
  fail 'データベースの初期化の指定が compose と CI で食い違っています'
elif ! printf '%s\n' "$COMPOSE_INITDB" | grep -q '^--locale-provider=builtin$'; then
  printf '  %s\n' "$(printf '%s ' $COMPOSE_INITDB)"
  fail '照合順序のプロバイダが builtin になっていません'
else
  pass '照合順序の指定が compose と CI で揃っています（builtin）'
fi

# 18 以降の公式イメージは、データを major ごとの下位ディレクトリへ置く。
# /var/lib/postgresql/data を結び付けたままにすると、使われない場所を渡して起動しなくなる。
# image の tag だけを上げて結び付けを直し忘れる形が、この検査の対象。
PG_MAJOR=$(printf '%s\n' "$PG_TAGS" | head -1 | sed 's/-.*$//')
if ! printf '%s' "$PG_MAJOR" | grep -qE '^[0-9]+$'; then
  fail 'compose から PostgreSQL の major を読めません'
elif [ "$PG_MAJOR" -ge 18 ] && grep -q ':/var/lib/postgresql/data$' docker-compose.yml; then
  grep -n ':/var/lib/postgresql/data$' docker-compose.yml
  fail "PostgreSQL ${PG_MAJOR} のデータの置き場が 17 以前の配置のままです"
else
  pass "PostgreSQL のデータの置き場が版に合っています"
fi

echo 'コンテナ'
# docker-compose.yml の top-level のブロックを 1 つ取り出す。
compose_block() {
  awk -v key="$1:" '
    $0 == key { inside = 1; next }
    inside && /^[^ #]/ { inside = 0 }
    inside { print }
  ' docker-compose.yml
}

# プロジェクト名を決めずに置くと、compose は clone 先のディレクトリ名から作る。
# 同じものを別の場所へ置いただけで、別のネットワークとボリュームが増える。
NAMELESS=''
grep -qE '^name: [a-z0-9-]+$' docker-compose.yml || NAMELESS="$NAMELESS プロジェクト"
compose_block networks | grep -qE '^ +name: ' || NAMELESS="$NAMELESS ネットワーク"
if [ -n "$NAMELESS" ]; then
  printf '  名前を決めていないもの:%s\n' "$NAMELESS"
  fail 'compose が作るものの名前を決めていません'
else
  pass 'compose が作るものの名前を決めています'
fi

# ボリュームの名前は compose に付けさせる。プロジェクト名を前に付けるのは
# compose の仕事で、キーの側にも書くと同じ語が重なった名前で並ぶ。
PROJECT_NAME=$(sed -n 's/^name: \(.*\)$/\1/p' docker-compose.yml | head -1)
VOLUME_KEYS=$(compose_block volumes | sed -n 's/^  \([A-Za-z0-9_.-]*\):.*$/\1/p')
REDUNDANT=$(printf '%s\n' "$VOLUME_KEYS" | grep "^${PROJECT_NAME}" || true)
if [ -n "$REDUNDANT" ]; then
  printf '  プロジェクト名で始まるキー: %s\n' "$(printf '%s ' $REDUNDANT)"
  fail 'ボリュームのキーがプロジェクト名を重ねています'
elif compose_block volumes | grep -qE '^ +name: '; then
  compose_block volumes | grep -nE '^ +name: '
  fail 'ボリュームの名前を手で固定しています'
else
  pass 'ボリュームの名前は compose が付けています'
fi

# 実行段には pnpm を入れていない。入れると、動かすのに要らない容量を配るうえ、
# 置き場を消した形ではコンテナを起動するたびに取り寄せ直すことになる。
ENTRY_POINTS=$(grep -hE '^(CMD|ENTRYPOINT) ' docker/api.Dockerfile; grep -hE '^ *command:' docker-compose.yml)
if printf '%s\n' "$ENTRY_POINTS" | grep -q 'pnpm'; then
  printf '%s\n' "$ENTRY_POINTS" | grep -n 'pnpm'
  fail 'コンテナの入口が pnpm を介しています'
else
  pass 'コンテナの入口は pnpm を介していません'
fi

# app とワーカーは同じイメージで動く。ビルドの定義を二か所へ書くと、
# 同じものを二度作るか、片方だけ古い定義で作られる。
BUILD_DEFINITIONS=$(grep -cE '^ *dockerfile: ' docker-compose.yml)
if [ "$BUILD_DEFINITIONS" -eq 1 ]; then
  pass 'コンテナのビルドの定義は 1 つです'
else
  printf '  ビルドの定義: %s 個\n' "$BUILD_DEFINITIONS"
  fail 'コンテナのビルドの定義が複数あります'
fi

# .dockerignore は「既定ですべてを除き、要るものだけを戻す」形で書く。
# 除く側を書き足す形だと、後から増えたディレクトリが黙って渡り続ける。
if grep -qx '\*' .dockerignore; then
  pass '.dockerignore はビルドへ渡すものを明示する形です'
else
  fail '.dockerignore が、除く側を書き足す形になっています'
fi

echo '文書'
# 説明は docs/ を正本とし、文書どうしをリンクで繋いでいる。
# 移動や改名でリンクが切れると、読む側は正本へ辿り着けないまま README だけを読む。
BROKEN_LINKS=''
for doc in $(git ls-files '*.md'); do
  DOC_DIR=$(dirname "$doc")
  # 外部 URL と、同じ文書の中の見出しへの参照は対象にしない。
  LINKS=$(grep -oE '\]\([^)#][^)]*\)' "$doc" \
    | sed 's/^](//; s/)$//; s/#.*$//' \
    | grep -vE '^(https?|mailto):' \
    | sort -u)
  for target in $LINKS; do
    [ -e "$DOC_DIR/$target" ] || BROKEN_LINKS="$BROKEN_LINKS
  $doc -> $target"
  done
done
if [ -n "$BROKEN_LINKS" ]; then
  printf '%s\n' "$BROKEN_LINKS"
  fail '文書のリンクに、辿れない先があります'
else
  pass '文書のリンクはすべて辿れます'
fi

# docs/README.md は文書の索引。載っていない文書は、置いてあっても読まれない。
# 決定の記録はディレクトリ単位で載せるため、個別には数えない。
UNLISTED=''
for doc in $(git ls-files 'docs/*.md' 'docs/*/*.md'); do
  case "$doc" in
    docs/README.md | docs/decisions/*) continue ;;
  esac
  grep -q "(${doc#docs/})" docs/README.md || UNLISTED="$UNLISTED ${doc#docs/}"
done
if [ -n "$UNLISTED" ]; then
  printf '  索引に無い文書:%s\n' "$UNLISTED"
  fail 'docs/README.md の索引に載っていない文書があります'
else
  pass 'docs/README.md の索引にすべての文書が載っています'
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
      *) fail "$PACKAGE が $DEPENDENCY へ依存しています（docs/development/architecture.md の依存方向に反します）" ;;
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
