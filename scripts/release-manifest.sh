#!/bin/sh
# 配るものと、それが何から出来ているかの対応を出す。
#
#   ./scripts/release-manifest.sh [出力先]
#
# 受け取った側が中身を自分で確かめられるようにするための一覧。
# 出すのは対応だけで、タグも署名もここでは行わない。
# どちらも所有者の判断と鍵が要る（docs/release/checklist.md）。
set -eu

OUTPUT="${1:--}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SOURCE_SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# 作業中の変更があるまま出すと、書いてある commit と中身が食い違う。
DIRTY=$(git status --porcelain | head -1)

emit() {
  printf '%s\n' "$1"
}

report() {
  emit '# 配るものと、その元'
  emit ''
  emit "対象の commit: $SOURCE_SHA"
  emit "branch: $BRANCH"
  if [ -n "$DIRTY" ]; then
    emit ''
    emit '**作業中の変更があります。この一覧は配れません。**'
    emit '書いてある commit と、手元の中身が食い違います。'
  fi
  emit ''

  emit '## コンテナ画像'
  emit ''
  if command -v docker > /dev/null 2>&1; then
    IMAGE="staffweave-release:$SOURCE_SHA"
    docker build --quiet -f docker/api.Dockerfile -t "$IMAGE" . > /dev/null
    DIGEST=$(docker image inspect "$IMAGE" --format '{{.Id}}')
    docker image rm -f "$IMAGE" > /dev/null 2>&1 || true
    emit "digest: $DIGEST"
  else
    emit 'docker が無いため出せません。'
  fi
  emit ''

  emit '## 構成一覧（SBOM）'
  emit ''
  SBOM_DIR="${SBOM_OUTPUT_DIR:-artifacts/sbom}"
  if [ -f "$SBOM_DIR/staffweave-workspace.cdx.json.sha256" ]; then
    for name in staffweave-workspace staffweave-container; do
      emit "$(cat "$SBOM_DIR/$name.cdx.json.sha256")"
    done
  else
    emit 'まだ作られていません。pnpm sbom:generate で作ってから、もう一度出してください。'
  fi
  emit ''

  emit '## タグの候補'
  emit ''
  emit "リリース候補の条件を満たしていれば、この commit にタグを付けられます: $SOURCE_SHA"
  emit ''
  emit '付けるかどうかと、署名するかどうかは所有者が決めます。'
  emit 'この手順ではどちらも行いません。署名には所有者の鍵が要り、'
  emit '鍵を持たない者が付けた署名は「誰が配ったか」を示せません。'
}

if [ "$OUTPUT" = '-' ]; then
  report
else
  report > "$OUTPUT"
  echo "書き出しました: $OUTPUT"
fi
