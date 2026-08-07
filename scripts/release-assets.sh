#!/bin/sh
# 正式版として配るものを、1 か所へまとめる。
#
#   ./scripts/release-assets.sh [出力先]
#
# 出すもの:
#
#   staffweave-agent-<版>.zip          打刻端末の配布物
#   staffweave-workspace.cdx.json      リポジトリの構成一覧
#   staffweave-container.cdx.json      コンテナの構成一覧
#   SHA256SUMS.txt                     上のすべての checksum
#   release-manifest.txt               版・commit・成果物の対応
#
# 署名はしない。署名には所有者の鍵が要り、鍵を持たない者が付けた署名は
# 「誰が配ったか」を示せない（docs/release/checklist.md）。
#
# 版は package.json の version が正本。ここでは読むだけで、書き換えない。
# 2 か所で決めると、必ずどちらかが古くなる。
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

OUTPUT="${1:-artifacts/release}"
VERSION=$(node -p "require('./package.json').version")
SOURCE_SHA=$(git rev-parse HEAD)

if [ "$VERSION" = '0.0.0' ]; then
  echo '版が 0.0.0 のままです。package.json の version を決めてください。' >&2
  exit 1
fi

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT"

echo "1/5 端末の配布物を作ります（v$VERSION）"
AGENT_DIR=$(mktemp -d)
cleanup() { rm -rf "$AGENT_DIR"; }
trap cleanup EXIT INT TERM
./scripts/package-agent.sh "$AGENT_DIR" > /dev/null

# zip の中は、展開してそのまま置ける形にする。
# 余計な親ディレクトリを挟むと、手順書のパスと合わなくなる。
ZIP_NAME="staffweave-agent-$VERSION.zip"
(cd "$AGENT_DIR" && zip -rq "$OLDPWD/$OUTPUT/$ZIP_NAME" staffweave-agent)

# Windows 向けの配布物は、Windows の上でしか組めない。読み取り装置の部品に
# 組み立てが要るため。別の job が組んだものを、ここへ持ってくる。
echo '2/5 Windows 向けの配布物を取り込みます'
WINDOWS_INPUT="${WINDOWS_AGENT_DIR:-artifacts/windows-agent}"
WINDOWS_ZIP="staffweave-agent-windows-x64-$VERSION.zip"
if [ -f "$WINDOWS_INPUT/$WINDOWS_ZIP" ]; then
  cp "$WINDOWS_INPUT/$WINDOWS_ZIP" "$OUTPUT/$WINDOWS_ZIP"
  # 構成一覧も一緒に来る。読み取りの部品まで含めた構成は Windows で組んだ側にしかない。
  [ -f "$WINDOWS_INPUT/staffweave-agent-windows.cdx.json" ] &&
    cp "$WINDOWS_INPUT/staffweave-agent-windows.cdx.json" "$OUTPUT/"
elif [ -n "${RELEASE_REQUIRE_WINDOWS_AGENT-}" ]; then
  echo "Windows 向けの配布物がありません（$WINDOWS_INPUT/$WINDOWS_ZIP）。" >&2
  echo 'Windows の job で組んでから、この手順を動かしてください。' >&2
  exit 1
else
  echo "  Windows 向けの配布物は入れていません（$WINDOWS_INPUT にありません）"
fi

echo '3/5 構成一覧を作ります'
SBOM_OUTPUT_DIR="$OUTPUT" ./scripts/generate-sbom.sh > /dev/null
# 生成の副産物（個別の checksum ファイル）は、まとめた一覧の側へ寄せる。
rm -f "$OUTPUT"/*.cdx.json.sha256

echo '4/5 checksum を並べます'
(cd "$OUTPUT" && shasum -a 256 -- * > SHA256SUMS.txt)

echo '5/5 対応を書き出します'
cat > "$OUTPUT/release-manifest.txt" <<MANIFEST
# 配るものと、その元

版: $VERSION
対象の commit: $SOURCE_SHA

## 成果物

$(cd "$OUTPUT" && cat SHA256SUMS.txt)

## 確かめ方

  shasum -a 256 -c SHA256SUMS.txt

構成一覧（SBOM）には、元にした commit が staffweave:source-sha として入っています。
書いてある commit と、受け取った成果物の checksum が揃っていることを確かめてください。

## 署名について

この手順では署名しません。署名には所有者の鍵が要り、
鍵を持たない者が付けた署名は「誰が配ったか」を示せません。
MANIFEST

echo ''
echo "書き出しました: $OUTPUT"
