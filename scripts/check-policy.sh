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
#
# `core.quotePath` を切る。既定では ASCII の外の文字を 8 進数のエスケープへ置き換えるため、
# 日本語のファイル名が `"\346\257\224..."` の形で並ぶ。
# 名前そのものを検査する側から見ると、その名前はどこにも無いことになる。
TRACKED=$(git -c core.quotePath=false ls-files | grep -v '^scripts/check-policy.sh$')

echo '名称の一貫性'
# 名前は 2 つだけ。人が読む `StaffWeave` と、機械が読む小文字の `staffweave`。
# `staff-weave` は npm のスコープ、コンテナ名、DB 名、HTTP ヘッダーのどれとも一致しない。
# 一度でも混ざると、どちらが正しいのかを毎回確かめることになる。
NAME_TARGETS="$TRACKED"
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

# 中身・ファイル名・branch・commit・PR を、同じ規則でまとめて検査する。
#
# 名前や語を残せる場所はいくつもある。中身だけを見ていると、他の経路から
# 入ったものを検査が通してしまう。経路を 1 つでも見落とすなら、
# 「無い」とは言わない。
#
# branch と commit は、Git の状態から推測しない。CI の checkout は既定で
# detached HEAD になり、履歴も 1 件しか取らない。推測すると branch 名は `HEAD`、
# commit は 1 件だけ、という状態のまま成功する。
# 対象は呼ぶ側が渡し、渡されていなければ「見ていない」と示す。
#
#   POLICY_HEAD_REF   branch 名
#   POLICY_BASE_SHA   commit の範囲の起点
#   POLICY_HEAD_SHA   範囲の終点
#   PR_TITLE PR_BODY  PR の題と本文

# 手元では、渡されていなくても分かるものを使う。CI では渡された値だけを見る。
if [ -n "${POLICY_HEAD_REF-}" ]; then
  SURFACE_REF="$POLICY_HEAD_REF"
elif [ -z "${CI-}" ]; then
  SURFACE_REF=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
else
  SURFACE_REF=''
  SURFACE_UNCHECKED='branch'
fi

if [ -n "${POLICY_BASE_SHA-}" ] && [ -n "${POLICY_HEAD_SHA-}" ]; then
  SURFACE_RANGE="${POLICY_BASE_SHA}..${POLICY_HEAD_SHA}"
elif [ -z "${CI-}" ]; then
  SURFACE_RANGE='origin/main..HEAD'
else
  SURFACE_RANGE=''
  SURFACE_UNCHECKED="${SURFACE_UNCHECKED-} commit"
fi

SURFACE_LOG=''
if [ -n "$SURFACE_RANGE" ]; then
  # 範囲を読めないまま 0 件にしない。読めなければ、見ていないものとして示す。
  if SURFACE_LOG=$(git log --format='%s%n%b' "$SURFACE_RANGE" 2>/dev/null); then
    :
  else
    SURFACE_LOG=''
    SURFACE_UNCHECKED="${SURFACE_UNCHECKED-} commit"
  fi
fi

SURFACE_PR=$(printf '%s\n%s' "${PR_TITLE-}" "${PR_BODY-}")

# 出すのは経路ごとの件数だけにする。一致した行を出すと、その行に並んでいた
# 語がそのままログへ残る。ログは PR の画面から誰でも読めるため、
# 伏せたい語を伏せた意味が無くなる。
#
#   $1 検査する正規表現（ERE）
#   $2 通ったときに出す名前
#   $3 落ちたときに出す理由
check_all_surfaces() {
  SURFACE_PATTERN=$1
  SURFACE_LABEL=$2
  SURFACE_REASON=$3

  # 中身は git grep で探す。改行区切りの一覧を xargs へ渡すと、
  # 名前に空白やタブを含むファイルが途中で切れ、そのファイルだけ検査されない。
  # この脚本自身は、検査の対象語をそのまま持つため除く。
  HIT_CONTENT=$(git grep -hiE "$SURFACE_PATTERN" -- . ':!scripts/check-policy.sh' 2>/dev/null \
    | grep -c . || true)
  # 名前の側も、NUL 区切りで受け取ってから 1 行ずつに直す。
  HIT_NAME=$(git -c core.quotePath=false ls-files -z \
    | tr '\0' '\n' | grep -v '^scripts/check-policy.sh$' | grep -ciE "$SURFACE_PATTERN" || true)
  HIT_BRANCH=$(printf '%s\n' "$SURFACE_REF" | grep -ciE "$SURFACE_PATTERN" || true)
  HIT_COMMIT=$(printf '%s\n' "$SURFACE_LOG" | grep -ciE "$SURFACE_PATTERN" || true)
  HIT_PR=$(printf '%s\n' "$SURFACE_PR" | grep -ciE "$SURFACE_PATTERN" || true)
  HIT_TOTAL=$((HIT_CONTENT + HIT_NAME + HIT_BRANCH + HIT_COMMIT + HIT_PR))

  if [ "$HIT_TOTAL" -ne 0 ]; then
    printf '  内容 %s 件 / ファイル名 %s 件 / branch %s 件 / commit %s 件 / PR %s 件\n' \
      "$HIT_CONTENT" "$HIT_NAME" "$HIT_BRANCH" "$HIT_COMMIT" "$HIT_PR"
    fail "$SURFACE_REASON（場所は出しません。手元で探してください）"
  elif [ -n "${SURFACE_UNCHECKED-}" ]; then
    # 見ていない経路があるなら、見た経路だけで「無い」と言わない。
    printf '  見ていない経路:%s\n' "$SURFACE_UNCHECKED"
    fail "$SURFACE_LABEL を、一部の経路で検査できませんでした"
  else
    pass "$SURFACE_LABEL はありません（内容・ファイル名・branch・commit・PR）"
  fi
}

echo '生成ツール由来の定型文'
# 中身だけを見ていた。branch 名・commit・PR の本文にも同じ定型文は入る。
# 入口を 1 つだけ塞いでも、他の入口から同じものが入る。
check_all_surfaces 'co-authored-by: *claude|generated with \[?claude' \
  '生成ツール由来の定型文' '生成ツール由来の定型文が含まれています'

echo '他の製品への言及'
# 機能の要件は StaffWeave の設計として書く。他の製品を引き合いに出して説明すると、
# その名前や画面の写しが入り込む入口になり、相手の版が変われば説明だけが古くなる。
#
# ここで見るのは「引き合いに出す言い回し」だけで、製品名の一覧は持たない。
# 一覧にすると、書かせたくない名前をこの脚本へ書き込むことになる。
# 言い回しを止めれば、名前を書く文そのものが成り立たなくなる。
#
# 「競合」は同時更新の意味で全体に出るため、単独では見ない。
check_all_surfaces \
  '比較元|比較対象製品|参考製品|参考にした製品|他社製品|他社の製品|他社のサービス|競合製品|競合サービス|競合他社|本家' \
  '他の製品を引き合いに出す言い回し' '他の製品を引き合いに出す言い回しが含まれています'

echo '指定した禁止語'
# 禁止語そのものは、この脚本にもリポジトリにも置かない。置いた時点で、
# 書かせたくない語をリポジトリが持つことになる。
#
# 語は呼ぶ側が渡す。CI では repository variable などから環境変数として渡す。
#
#   POLICY_FORBIDDEN_PATTERN  禁止語の正規表現（ERE）
#
# CI では、渡されていないこと自体を失敗にする。
# 「渡し忘れたから通った」は、検査を外したのと同じ結果になる。設定の欠落は
# 誰も見ないため、通してしまうと外れたことに気付く機会が無い。
#
# 手元では止めない。この語はワークスペース側の設定であり、リポジトリを
# 複製しただけの人が持っていないのはふつうの状態。ただし見ていないことは示す。
if [ -n "${POLICY_FORBIDDEN_PATTERN-}" ]; then
  check_all_surfaces "$POLICY_FORBIDDEN_PATTERN" '指定した禁止語' '指定した禁止語が含まれています'
elif [ -n "${CI-}" ]; then
  printf '  POLICY_FORBIDDEN_PATTERN が渡されていません\n'
  fail '指定した禁止語を検査できませんでした（CI では渡されていないこと自体を失敗にします）'
else
  printf '  POLICY_FORBIDDEN_PATTERN が渡されていないため、指定した語は見ていません\n'
  pass '手元では検査する語が渡されていなくても止めません（CI では失敗にします）'
fi

# 取り込んだ画像と PDF は、中身を差分で読めない。何が写っているかを確かめないまま
# 再配布することになるため、置かない。図は本文か SVG（文字として読める形）で書く。
IMPORTED_MEDIA=$(printf '%s\n' "$TRACKED" | grep -iE '\.(pdf|png|jpe?g|gif|webp|bmp|tiff?|heic)$' || true)
if [ -n "$IMPORTED_MEDIA" ]; then
  printf '  %s\n' "$(printf '%s ' $IMPORTED_MEDIA)"
  fail '差分で読めない画像や PDF が追跡されています'
else
  pass '差分で読めない画像や PDF はありません'
fi

echo '検索できる形'
# NUL をソースへ直に書かない。1 バイトでも入ると file・grep・ripgrep はその
# ファイルをバイナリと見なし、中身を検索の対象から外す。
# 見た目には何も現れないため、検索に出てこないことでしか気付けない。
#
# 同じ値は `\u0000` と書ける。実行時の文字は変わらないまま、検索には残る。
#
# まず全ファイルをまとめて数える。1 ファイルずつ開くと 350 回の起動になり、
# 何も見つからない平常時にいちばん時間を使う形になる。
# 見つかったときだけ、どのファイルかを絞り込む。
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
# ライセンスは LICENSE と README の 2 か所に現れる。
# 片方だけが変わった状態を作れないようにする。
if grep -q 'MIT License' LICENSE; then
  pass 'LICENSE が MIT License です'
else
  fail 'LICENSE が MIT License ではありません'
fi

# 名義は実在の権利者にする。いない集団（`staffweave contributors` など）を指す形だと、
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

# Action は完全なコミット SHA で固定する。
# tag は同じ名前のまま指す先が変わりうるため、版として当てにできない。
# 指す先が変われば、確かめずに他人のコードを動かすことになる。
WORKFLOW_FILES=$(git ls-files '.github/workflows/*')
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

echo 'ワークフロー'
# 検証は 3 つのワークフローへ分けている。どれが欠けても、そこにあった検証が黙って消える。
#
#   ci.yml       どの変更でも走らせる静的検証
#   runtime.yml  データベース・ブラウザ・Docker を動かす検証
#   sbom.yml     配布物の構成一覧
#   release.yml  tag から正式版を配る
#   windows-agent.yml  Windows の上でしか確かめられない常駐の経路
ALWAYS_WORKFLOW='.github/workflows/ci.yml'
RUNTIME_WORKFLOW='.github/workflows/runtime.yml'
SBOM_WORKFLOW='.github/workflows/sbom.yml'
RELEASE_WORKFLOW='.github/workflows/release.yml'
WINDOWS_WORKFLOW='.github/workflows/windows-agent.yml'
for required in "$ALWAYS_WORKFLOW" "$RUNTIME_WORKFLOW" "$SBOM_WORKFLOW" "$RELEASE_WORKFLOW" \
  "$WINDOWS_WORKFLOW"; do
  if [ -f "$required" ]; then
    pass "$required があります"
  else
    fail "$required がありません"
  fi
done

# 名前を並べていないワークフローが増えると、この節の検査はその中身を
# 何も見ないまま通る。分けた意味を保つため、置く場所は上の 5 つに固定する。
#
# release.yml を足したのは、tag から配る経路が要るため。
# 走る条件（tag と手動）も、Release を作る手順も CI では確かめられないので、
# 取り決めそのものは test/release-assets.test.ts が固定している。
#
# windows-agent.yml を足したのは、Windows でしか確かめられない経路があるため。
# 常駐の登録・開始・停止・削除は、Linux の runner では動かして確かめられない。
EXTRA=$(git ls-files '.github/workflows/*' \
  | grep -vxF "$ALWAYS_WORKFLOW" | grep -vxF "$RUNTIME_WORKFLOW" \
  | grep -vxF "$SBOM_WORKFLOW" | grep -vxF "$RELEASE_WORKFLOW" \
  | grep -vxF "$WINDOWS_WORKFLOW" || true)
if [ -n "$EXTRA" ]; then
  printf '  %s\n' "$(printf '%s ' $EXTRA)"
  fail '名前を並べていないワークフローがあります'
else
  pass 'ワークフローは決めた 5 つだけです'
fi

# Secret と、PR が書き換えられるコードを、同じ job へ置かない。
# 置いた時点で、脚本を 1 行変えた PR から Secret を読み出せる。
#
# Secret を使う検査が要るなら、PR のコードを取り出しも実行もしない別のワークフローへ置く。
# ここで見るのは、いまある 2 つが Secret を受け取っていないことだけ。
SECRET_IN_UNTRUSTED=$(grep -l 'secrets\.' "$ALWAYS_WORKFLOW" "$RUNTIME_WORKFLOW" 2>/dev/null || true)
if [ -n "$SECRET_IN_UNTRUSTED" ]; then
  printf '  %s\n' "$(printf '%s ' $SECRET_IN_UNTRUSTED)"
  fail 'PR のコードを動かすワークフローが Secret を受け取っています'
else
  pass 'PR のコードを動かすワークフローは Secret を受け取りません'
fi

# `paths` を持たない pull_request は、変更の内容によらず必ず走る。
# それが 2 つ以上あると、片方を軽く保っても待ち時間は縮まない。
ALWAYS_RUNNING=''
for workflow in $(git ls-files '.github/workflows/*'); do
  grep -q '^  pull_request:' "$workflow" || continue
  sed -n '/^  pull_request:/,/^  [^ ]/p' "$workflow" | grep -q '^    paths:' && continue
  ALWAYS_RUNNING="$ALWAYS_RUNNING $workflow"
done
if [ "$ALWAYS_RUNNING" = " $ALWAYS_WORKFLOW" ]; then
  pass "どの PR でも走るワークフローは $ALWAYS_WORKFLOW だけです"
else
  printf '  どの PR でも走るもの:%s\n' "$ALWAYS_RUNNING"
  fail "どの PR でも走るワークフローが $ALWAYS_WORKFLOW 以外にあります"
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

  # 文書を対象へ入れると、文書だけの PR でもデータベースとブラウザが立ち上がる。
  # 合否は変わらないまま待ち時間だけが増える。
  DOC_TARGETS=$(printf '%s\n' "$PUSH_PATHS" | grep -E '(^|/)docs?/|\.md$' || true)
  if [ -n "$DOC_TARGETS" ]; then
    printf '  文書を指すもの: %s\n' "$(printf '%s ' $DOC_TARGETS)"
    fail 'runtime.yml の対象に文書が入っています'
  else
    pass 'runtime.yml の対象に文書は入っていません'
  fi
fi

# ここから下は「どの PR でも走る側」を軽いまま保つための検査。
# 待ち時間はここで決まる。重い検証は runtime.yml へ置く。
if [ -f "$ALWAYS_WORKFLOW" ]; then
  # サービスを持つと、使う使わないに関わらず起動を待つ。いまは 1 つあたり 15 秒。
  if grep -q '^ *services:' "$ALWAYS_WORKFLOW"; then
    fail "$ALWAYS_WORKFLOW が services を持っています（データベースなどは runtime.yml へ）"
  else
    pass "$ALWAYS_WORKFLOW は何も立ち上げません"
  fi

  # 走らせてよいものを、ここで一覧にして固定する。
  # この一覧へ 1 行足すことが、すべての PR の待ち時間を延ばす判断そのものになる。
  # 判断した結果として足すのは構わない。黙って増えないようにする。
  ALLOWED_COMMANDS='pnpm check:audit
pnpm check:policy
pnpm install --frozen-lockfile
pnpm lint
pnpm test:unit
pnpm typecheck'
  ACTUAL_COMMANDS=$(sed -n 's/^ *run: //p' "$ALWAYS_WORKFLOW" | sort -u)
  UNLISTED=$(printf '%s\n' "$ACTUAL_COMMANDS" | grep -vxF "$ALLOWED_COMMANDS" || true)
  if [ -n "$UNLISTED" ]; then
    printf '  一覧に無いもの:\n'
    printf '    %s\n' "$UNLISTED"
    fail "$ALWAYS_WORKFLOW が、決めた一覧に無いものを走らせています"
  else
    pass "$ALWAYS_WORKFLOW が走らせるのは、決めた $(printf '%s\n' "$ACTUAL_COMMANDS" | grep -c .) つだけです"
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

# 見出しがファイル名を名乗るなら、指し先と同じ名前にする。
# 食い違うと、読む側はその名前のファイルを探し、どこにも無いまま終わる。
# 辿れるかどうかの検査は通ってしまうため、名前どうしを別に突き合わせる。
MISLABELED=$(for doc in $(git ls-files '*.md'); do
  grep -oE '\[[^]]*\.md\]\([^)#][^)]*\)' "$doc" 2>/dev/null \
    | grep -vE '\]\((https?|mailto):' \
    | sed -E 's/^\[(.*)\]\((.*)\)$/\1\t\2/' \
    | while IFS="$(printf '\t')" read -r label target; do
        [ "${label##*/}" = "${target##*/}" ] || printf '  %s: [%s](%s)\n' "$doc" "$label" "$target"
      done
done)
if [ -n "$MISLABELED" ]; then
  printf '%s\n' "$MISLABELED"
  fail 'リンクの見出しが、指し先と違うファイル名を名乗っています'
else
  pass 'リンクの見出しは指し先と同じ名前です'
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

echo '製品の能力'
# 「いま何ができるか」と「どの順で作るか」は、この 2 つを正本にする。
# どちらかが欠けると、リポジトリを受け取った側は Issue を読むまで位置付けを判断できない。
#
# 中身の形は検査しない。以前は Markdown の表の形を専用の脚本で厳密に読んでいたが、
# 確かめられるのは「表が壊れていないか」までで、書いてあることが本当かは分からない。
# 文書を直すたびに脚本とそのテストも直すことになり、割に合わなかった。
# 能力の正しさは、実装とテストを見てレビューで判断する。
for required in docs/product/capability-matrix.md docs/roadmap.md; do
  if [ -f "$required" ]; then
    pass "$required があります"
  else
    fail "$required がありません"
  fi
done

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
