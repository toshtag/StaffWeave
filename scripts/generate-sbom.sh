#!/bin/sh
# 配布物のソフトウェア構成を機械可読な形で書き出す。
#
#   pnpm sbom:generate
#
# 二つの SBOM を別々に作る。まとめない。
#
#   staffweave-workspace.cdx.json   リポジトリをビルド・検証するための構成
#   staffweave-container.cdx.json   セルフホスト用 production コンテナの構成
#
# 開発時の依存と、実際に稼働するコンテナの中身は違う。
# 一つの一覧にすると、どちらの話なのかが読めなくなる。
#
# 生成物は Git 管理しない。commit ごとに作り直す。
set -eu

OUTPUT_DIR="${SBOM_OUTPUT_DIR:-artifacts/sbom}"

# 生成に使う道具は digest で固定する。tag は同じ名前のまま中身が変わりうる。
SYFT_IMAGE="anchore/syft@sha256:1288ea4c8b38767b4e620c1e312c8cb26b6e887a99b4f07ab6cd19fc6f225026"
SYFT_VERSION="v1.50.0"

# SBOM の対象にするイメージ。production の Dockerfile をそのまま使う。
# SBOM 専用の Dockerfile を作ると、確かめている構成が配るものと別になる。
SOURCE_SHA="$(git rev-parse HEAD)"
IMAGE_TAG="staffweave-sbom:$SOURCE_SHA"

WORKSPACE_SBOM="$OUTPUT_DIR/staffweave-workspace.cdx.json"
CONTAINER_SBOM="$OUTPUT_DIR/staffweave-container.cdx.json"

# 一時ファイルとイメージは、失敗しても残さない。
ARCHIVE=""
cleanup() {
  [ -n "$ARCHIVE" ] && rm -f "$ARCHIVE"
  docker image rm -f "$IMAGE_TAG" > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

umask 022
mkdir -p "$OUTPUT_DIR"

echo "SBOM の生成に使う道具"
echo "  syft $SYFT_VERSION"
echo "  $SYFT_IMAGE"
echo ''

# 1. workspace
#
# リポジトリを読ませる。lockfile から開発・テスト依存を含めた構成を出す。
#
# lockfile だけでは `@staffweave/*` 自身が出ない。workspace のパッケージは
# lockfile の解決対象ではなく、参照として書かれるだけであるため。
# package.json も読ませて、リポジトリが何を提供しているかを含める。
echo 'workspace の構成を書き出します'
docker run --rm \
  --volume "$PWD:/src:ro" \
  --workdir /src \
  "$SYFT_IMAGE" \
  scan dir:/src \
  --select-catalogers '+javascript-package-cataloger' \
  --source-name staffweave-workspace \
  --output "cyclonedx-json=/dev/stdout" \
  --quiet > "$WORKSPACE_SBOM"

# 2. production コンテナ
#
# 通常の production build と同じものを作り、その中身を読む。
echo 'production コンテナを構築します'
docker build --quiet -f docker/api.Dockerfile -t "$IMAGE_TAG" . > /dev/null

# Docker socket を syft へ渡さず、書き出した archive を読ませる。
# socket を渡すと、この手順が他のコンテナやイメージへも触れるようになる。
# `mktemp -t` の書式は BSD と GNU で違う。どちらでも同じ意味になる形で書く。
ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/staffweave-sbom-image.XXXXXX")"
docker save "$IMAGE_TAG" -o "$ARCHIVE"

echo 'production コンテナの構成を書き出します'
docker run --rm \
  --volume "$ARCHIVE:/image.tar:ro" \
  "$SYFT_IMAGE" \
  scan docker-archive:/image.tar \
  --source-name staffweave-container \
  --output "cyclonedx-json=/dev/stdout" \
  --quiet > "$CONTAINER_SBOM"

# 3. 元にした commit を書き込む
#
# 出来上がった SBOM だけを渡されても、どの時点のソースから作ったのかが分からない。
# 分からなければ、SBOM に載っている構成を自分で作り直して確かめることもできない。
# 表に出す名前（metadata.component.version）へ commit を入れる。
for sbom in "$WORKSPACE_SBOM" "$CONTAINER_SBOM"; do
  SOURCE_SHA="$SOURCE_SHA" node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs";
    const path = process.argv[1];
    const document = JSON.parse(readFileSync(path, "utf8"));
    document.metadata ??= {};
    document.metadata.component ??= {};
    const properties = document.metadata.component.properties ?? [];
    properties.push({ name: "staffweave:source-sha", value: process.env.SOURCE_SHA });
    document.metadata.component.properties = properties;
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  ' "$sbom"
done

# 4. チェックサム
#
# 名前と digest だけを書く。生成した機械の場所は残さない。
for sbom in "$WORKSPACE_SBOM" "$CONTAINER_SBOM"; do
  ( cd "$(dirname "$sbom")" && shasum -a 256 "$(basename "$sbom")" > "$(basename "$sbom").sha256" )
done

echo ''
echo "書き出しました: $OUTPUT_DIR"
ls -1 "$OUTPUT_DIR"
