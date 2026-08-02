#!/bin/sh
# 書き出した SBOM が CycloneDX として正しい形かを、公式の検証ツールで確かめる。
#
#   pnpm sbom:validate
#
# 生成と検証を同じ実装だけで行わない。
# 「書き出せたから正しい」では、形式が崩れていても気付けない。
set -eu

OUTPUT_DIR="${SBOM_OUTPUT_DIR:-artifacts/sbom}"

# 検証に使う道具も digest で固定する。
CYCLONEDX_IMAGE="cyclonedx/cyclonedx-cli@sha256:252c2e26f468c25fea1e63ecde1bc3198ad6e9dbb57f5ed3236bddcb2281b3a7"
CYCLONEDX_VERSION="0.33.1"

echo "SBOM の検証に使う道具"
echo "  cyclonedx-cli $CYCLONEDX_VERSION"
echo "  $CYCLONEDX_IMAGE"
echo ''

for name in staffweave-workspace staffweave-container; do
  sbom="$OUTPUT_DIR/$name.cdx.json"
  if [ ! -f "$sbom" ]; then
    echo "  NG $name.cdx.json がありません。pnpm sbom:generate を実行してください" >&2
    exit 1
  fi
  # 仕様版は生成ツールが書いたものをそのまま使う。手で書き換えない。
  version=$(sed -n 's/.*"specVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sbom" | head -1)
  printf '  %s（CycloneDX %s）: ' "$name.cdx.json" "$version"
  docker run --rm \
    --volume "$PWD/$OUTPUT_DIR:/sbom:ro" \
    "$CYCLONEDX_IMAGE" \
    validate --input-file "/sbom/$name.cdx.json" \
    --input-format json --input-version "v$(echo "$version" | tr '.' '_')" \
    > /dev/null
  echo 'OK'
done

echo ''
echo 'CycloneDX の形式として正しいことを確認しました。'
