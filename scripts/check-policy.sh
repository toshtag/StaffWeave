#!/bin/sh
# リポジトリの不変条件を機械的に確かめる。
#
#   pnpm check:policy
#
# ここで見るのは、壊れるとコード・安全性・再現性に影響するものだけ。
# 文体や書き方の好みは対象にしない。寄稿者の PR を、書き方の理由で落とさない。
set -eu

FAILED=0

fail() {
  printf '  NG %s\n' "$1"
  FAILED=1
}

pass() {
  printf '  OK %s\n' "$1"
}

# `core.quotePath` を切る。既定では ASCII の外の文字を 8 進数のエスケープへ置き換えるため、
# 日本語のファイル名が `"\346\257\224..."` の形で並ぶ。
# 名前そのものを検査する側から見ると、その名前はどこにも無いことになる。
#
# 検査自身が例として持つ文字列を拾わないよう、この脚本は対象から外す。
TRACKED=$(git -c core.quotePath=false ls-files | grep -v '^scripts/check-policy.sh$')

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

echo '識別子'
# 機械が読む名前は `staffweave` の 1 つだけ。`staff-weave` は npm のスコープ、
# コンテナ名、DB 名、HTTP ヘッダーのどれとも一致しない。
#
# 見るのは、その名前を機械が読む面だけにする。本文まで見ると、説明や引用で
# その形を書いただけで落ちる。人が読む文章は、この検査の対象ではない。
IDENTIFIER_SURFACES=$(printf '%s\n' "$TRACKED" \
  | grep -E '(^|/)(package\.json|docker-compose\.yml|pnpm-workspace\.yaml|\.env\.example)$|^docker/|^\.github/workflows/')
if printf '%s\n' "$IDENTIFIER_SURFACES" | xargs grep -l 'staff-weave' 2>/dev/null | grep . > /dev/null; then
  printf '%s\n' "$IDENTIFIER_SURFACES" | xargs grep -n 'staff-weave' 2>/dev/null | head -20
  fail '識別子に staff-weave の形が使われています'
else
  pass '識別子に staff-weave の形はありません'
fi

# NUL をソースへ直に書かない。1 バイトでも入ると file・grep・ripgrep はその
# ファイルをバイナリと見なし、中身を検索の対象から外す。
# 見た目には何も現れないため、検索に出てこないことでしか気付けない。
# 同じ値は `\u0000` と書ける。実行時の文字は変わらないまま、検索には残る。
if [ "$(printf '%s\n' "$TRACKED" | xargs cat | tr -dc '\000' | wc -c | tr -d ' ')" = '0' ]; then
  pass 'NUL を直に書いたファイルはありません'
else
  printf '%s\n' "$TRACKED" | while IFS= read -r file; do
    [ -n "$file" ] || continue
    if [ "$(tr -dc '\000' < "$file" | wc -c | tr -d ' ')" != '0' ]; then
      printf '%s\n' "$file"
    fi
  done
  fail 'NUL を直に書いたファイルがあります'
fi

echo 'ライセンス'
if grep -q 'MIT License' LICENSE; then
  pass 'LICENSE が MIT License です'
else
  fail 'LICENSE が MIT License ではありません'
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

echo 'ワークフロー'
RUNTIME_WORKFLOW='.github/workflows/runtime.yml'
WORKFLOW_FILES=$(git ls-files '.github/workflows/*')

# Action は完全なコミット SHA で固定する。
# tag は同じ名前のまま指す先が変わりうるため、版として当てにできない。
# 指す先が変われば、確かめずに他人のコードを動かすことになる。
if [ -z "$WORKFLOW_FILES" ]; then
  fail '.github/workflows にワークフローがありません'
else
  UNPINNED=$(printf '%s\n' "$WORKFLOW_FILES" | xargs grep -hE 'uses:' \
    | grep -vE 'uses: [^@]+@[0-9a-f]{40}( |$)' || true)
  if [ -n "$UNPINNED" ]; then
    printf '%s\n' "$UNPINNED"
    fail 'コミット SHA で固定していない Action があります'
  else
    pass 'すべてのワークフローの Action はコミット SHA で固定されています'
  fi
fi

# Secret と、PR が書き換えられるコードを、同じ job へ置かない。
# 置いた時点で、脚本を 1 行変えた PR から Secret を読み出せる。
# Secret を使う検査が要るなら、PR のコードを取り出しも実行もしない側へ置く。
UNTRUSTED=''
for workflow in $WORKFLOW_FILES; do
  grep -q '^  pull_request:' "$workflow" || continue
  grep -q 'secrets\.' "$workflow" && UNTRUSTED="$UNTRUSTED $workflow"
done
if [ -n "$UNTRUSTED" ]; then
  printf '  %s\n' "$(printf '%s ' $UNTRUSTED)"
  fail 'PR のコードを動かすワークフローが Secret を受け取っています'
else
  pass 'PR のコードを動かすワークフローは Secret を受け取りません'
fi

# runtime.yml は push と pull_request で同じ paths を持つ。
# GitHub Actions は YAML の別名を読まないため一覧を二度書いており、
# 片方だけを直すと、PR で走った検証が main で走らなくなる。
if [ -f "$RUNTIME_WORKFLOW" ]; then
  # `paths:` から、次の同じ深さのキーまでに並ぶ一覧の要素を取り出す。
  workflow_paths() {
    awk -v event="  $1:" '
      $0 == event { inside = 1; next }
      inside && /^  [^ ]/ { inside = 0 }
      inside && /^    paths:/ { collecting = 1; next }
      collecting && /^      - / { sub(/^      - /, ""); print; next }
      collecting { collecting = 0 }
    ' "$RUNTIME_WORKFLOW"
  }
  PUSH_PATHS=$(workflow_paths push)
  PR_PATHS=$(workflow_paths pull_request)
  if [ -z "$PUSH_PATHS" ]; then
    fail 'runtime.yml の push に paths がありません'
  elif [ "$PUSH_PATHS" != "$PR_PATHS" ]; then
    printf '  push のみ: %s\n' "$(printf '%s\n' "$PUSH_PATHS" | grep -vxF "$PR_PATHS" | tr '\n' ' ')"
    printf '  PR のみ:   %s\n' "$(printf '%s\n' "$PR_PATHS" | grep -vxF "$PUSH_PATHS" | tr '\n' ' ')"
    fail 'runtime.yml の対象が push と pull_request で食い違っています'
  else
    pass "runtime.yml の対象が push と pull_request で揃っています（$(printf '%s\n' "$PUSH_PATHS" | grep -c .) 件）"
  fi
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
    pass "$dep の版指定はパッケージ間で揃っています（${RANGES}）"
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

# 開発機と CI が別の版で動くと、ローカルで通った SQL が CI では別の版で走る。
# tag は「版-基盤」の形で書く（`18.4-bookworm`、`18-bookworm`）。
# latest や bookworm 単独のような動く tag は、版として当てにできない。
PG_TAGS=$(grep -hoE 'image: postgres:[^ ]+' docker-compose.yml "$RUNTIME_WORKFLOW" \
  | sed 's/^image: postgres://' \
  | sort -u)
if [ "$(printf '%s\n' "$PG_TAGS" | grep -c .)" -ne 1 ]; then
  printf '  postgres: %s\n' "$(printf '%s ' $PG_TAGS)"
  fail 'PostgreSQL の版が compose と CI で食い違っています'
elif ! printf '%s' "$PG_TAGS" | grep -qE '^[0-9]+(\.[0-9]+)?-[a-z][a-z0-9]*$'; then
  printf '  postgres: %s\n' "$PG_TAGS"
  fail 'PostgreSQL の tag が「版-基盤」の形になっていません'
else
  pass "PostgreSQL の版が compose と CI で揃っています（${PG_TAGS}）"
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
CI_INITDB=$(initdb_options "$RUNTIME_WORKFLOW")
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
PG_MAJOR=$(printf '%s\n' "$PG_TAGS" | head -1 | sed 's/[.-].*$//')
if ! printf '%s' "$PG_MAJOR" | grep -qE '^[0-9]+$'; then
  fail 'compose から PostgreSQL の major を読めません'
elif [ "$PG_MAJOR" -ge 18 ] && grep -q ':/var/lib/postgresql/data$' docker-compose.yml; then
  grep -n ':/var/lib/postgresql/data$' docker-compose.yml
  fail "PostgreSQL ${PG_MAJOR} のデータの置き場が 17 以前の配置のままです"
else
  pass "PostgreSQL のデータの置き場が版に合っています"
fi

echo 'コンテナ'
# .dockerignore は「既定ですべてを除き、要るものだけを戻す」形で書く。
# 除く側を書き足す形だと、後から増えたディレクトリが黙って渡り続ける。
if grep -qx '\*' .dockerignore; then
  pass '.dockerignore はビルドへ渡すものを明示する形です'
else
  fail '.dockerignore が、除く側を書き足す形になっています'
fi

echo '文書'
# 移動や改名でリンクが切れると、読む側は指し先へ辿り着けない。
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

DEPENDENCY_FAILED=0
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
      *)
        DEPENDENCY_FAILED=1
        fail "$PACKAGE が $DEPENDENCY へ依存しています（docs/development/architecture.md の依存方向に反します）"
        ;;
    esac
  done
done
if [ "$DEPENDENCY_FAILED" -eq 0 ]; then
  pass '依存方向は文書のとおりです'
fi

if [ "$FAILED" -ne 0 ]; then
  echo ''
  echo 'リポジトリの不変条件に反する箇所があります。'
  exit 1
fi

echo ''
echo 'すべての検査を通過しました。'
