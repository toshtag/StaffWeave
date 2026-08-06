#!/bin/sh
# 配るものと、それが何から出来ているかの対応を出す。
#
#   ./scripts/release-manifest.sh [出力先]
#
# 受け取った側が中身を自分で確かめられるようにするための一覧。
#
# 条件が揃わなければ、一覧を出さずに非 0 で終える。
# 文章で「配れません」と書きながら 0 で終えると、判定へ組み込んだときに
# 条件を満たさない commit がそのまま通る。
#
# 出すのは対応だけで、タグも署名もここでは行わない。
# どちらも所有者の判断と鍵が要る（docs/release/checklist.md）。
set -eu

OUTPUT="${1:--}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SBOM_DIR="${SBOM_OUTPUT_DIR:-artifacts/sbom}"

PROBLEMS=''
note() {
  PROBLEMS="$PROBLEMS
  - $1"
}

# 1. ソースの状態
#
# 作業中の変更があると、書いてある commit と手元の中身が食い違う。
if [ -n "$(git status --porcelain | head -1)" ]; then
  note '作業中の変更があります。commit してから、もう一度実行してください。'
fi

SOURCE_SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# どの枝から作ったか分からない成果物は、あとから辿れない。
if [ "$BRANCH" = 'HEAD' ]; then
  note 'いま branch の上に居ません（detached HEAD）。どこから作ったのかを辿れません。'
fi

# 2. コンテナ画像
#
# digest を出せないなら、配るものを特定できない。
DIGEST=''
if ! command -v docker > /dev/null 2>&1; then
  note 'docker がありません。コンテナの digest を出せません。'
elif ! docker info > /dev/null 2>&1; then
  note 'docker が動いていません。コンテナの digest を出せません。'
else
  IMAGE="staffweave-release:$SOURCE_SHA"
  if docker build --quiet -f docker/api.Dockerfile -t "$IMAGE" . > /dev/null 2>&1; then
    DIGEST=$(docker image inspect "$IMAGE" --format '{{.Id}}')
    docker image rm -f "$IMAGE" > /dev/null 2>&1 || true
  else
    note 'コンテナを組めませんでした。'
  fi
fi

# 3. 構成一覧
#
# 中身と並べて配るチェックサム、書いてある commit まで確かめる。
# 「ファイルがある」だけでは、古い一覧を配るのを止められない。
if [ ! -f "$SBOM_DIR/staffweave-workspace.cdx.json" ] ||
   [ ! -f "$SBOM_DIR/staffweave-container.cdx.json" ]; then
  note "構成一覧がありません（$SBOM_DIR）。pnpm sbom:generate で作ってください。"
elif ! SBOM_OUTPUT_DIR="$SBOM_DIR" SBOM_EXPECTED_SOURCE_SHA="$SOURCE_SHA" \
       node "$ROOT/scripts/verify-sbom.mjs" > /dev/null 2>&1; then
  note '構成一覧が、いまの commit と噛み合っていません。作り直してください。'
fi

if [ -n "$PROBLEMS" ]; then
  echo '配れる状態ではありません。' >&2
  printf '%s\n' "$PROBLEMS" >&2
  exit 1
fi

report() {
  cat <<REPORT
# 配るものと、その元

対象の commit: $SOURCE_SHA
branch: $BRANCH

## コンテナ画像

digest: $DIGEST

## 構成一覧（SBOM）

$(cat "$SBOM_DIR/staffweave-workspace.cdx.json.sha256")
$(cat "$SBOM_DIR/staffweave-container.cdx.json.sha256")

## タグの候補

この commit にタグを付けられます: $SOURCE_SHA

付けるかどうかと、署名するかどうかは所有者が決めます。
この手順ではどちらも行いません。署名には所有者の鍵が要り、
鍵を持たない者が付けた署名は「誰が配ったか」を示せません。
REPORT
}

if [ "$OUTPUT" = '-' ]; then
  report
else
  report > "$OUTPUT"
  echo "書き出しました: $OUTPUT"
fi
