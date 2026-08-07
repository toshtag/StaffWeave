#!/bin/sh
# リリース候補として配れる状態かを、ひととおり確かめる。
#
#   ./scripts/verify-release-candidate.sh
#
# `pnpm verify` との違い:
#
#   pnpm verify   直したものが壊れていないかを見る。毎日の作業で使う。
#   これ          配れる状態かを見る。コンテナを組み、構成一覧を作り、
#                 成果物と元の対応まで揃うことを確かめる。
#
# 分けているのは、コンテナのビルドと構成一覧の生成に数分かかるため。
# 毎回の作業で待たせると、待ちたくないから確かめない方向へ進む。
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo '1/4 直したものが壊れていないか'
pnpm verify

echo ''
echo '2/4 コンテナを組めるか'
IMAGE="staffweave-release-candidate:$(git rev-parse HEAD)"
docker build --quiet -f docker/api.Dockerfile -t "$IMAGE" . > /dev/null
# 通信できない環境で入口が動くことも、ここで見る。
docker run --rm --network none "$IMAGE" tsx --version > /dev/null
docker image rm -f "$IMAGE" > /dev/null 2>&1 || true

echo ''
echo '3/4 構成一覧を作り、いまの commit と噛み合うか'
pnpm sbom:generate > /dev/null
SBOM_EXPECTED_SOURCE_SHA="$(git rev-parse HEAD)" pnpm sbom:verify > /dev/null

echo ''
echo '4/4 配るものと元の対応が揃うか'
pnpm release:manifest > /dev/null

echo ''
echo 'リリース候補の条件を満たしています。'
echo '正式リリースには、実機・第三者・試行運用の確認が別に要ります。'
echo 'docs/release/checklist.md の 4 章を読んでください。'
