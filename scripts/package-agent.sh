#!/bin/sh
# 打刻端末の Agent を、配布できる形にまとめる。
#
#   ./scripts/package-agent.sh [出力先]
#
# 作るのは、Node.js を同梱しない素の配布物と、Windows のサービスとして
# 登録・削除するための手順書き。実行ファイルは作らない。
# 作ると、署名と配布の方式が決まっていない今、署名なしの実行ファイルが出回る。
#
# ここで作るものは、Windows が無くても作れる。実機での登録と再起動の確認だけを
# docs/operations/device-agent-service.md のチェックリストへ残す。
set -eu

OUTPUT="${1:-artifacts/agent}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)

rm -rf "${OUTPUT}"
mkdir -p "${OUTPUT}/staffweave-agent"

# 動かすのに要るものだけを入れる。テストと型定義は入れない。
for package in agent contracts domain; do
  mkdir -p "${OUTPUT}/staffweave-agent/packages/${package}"
  cp "${ROOT}/packages/${package}/package.json" \
     "${OUTPUT}/staffweave-agent/packages/${package}/package.json"
  mkdir -p "${OUTPUT}/staffweave-agent/packages/${package}/src"
  (cd "${ROOT}/packages/${package}/src" && find . -name '*.ts' ! -name '*.test.ts' -print) \
    | while read -r file; do
        mkdir -p "$(dirname "${OUTPUT}/staffweave-agent/packages/${package}/src/${file}")"
        cp "${ROOT}/packages/${package}/src/${file}" \
           "${OUTPUT}/staffweave-agent/packages/${package}/src/${file}"
      done
done

# サービスとして登録する手順。実行はしない。実行すると、この場の権限で登録される。
cat > "${OUTPUT}/staffweave-agent/install-service.ps1" <<'PS1'
# StaffWeave の打刻 Agent を Windows サービスとして登録する。
#
# 管理者として実行すること。登録の前に、この端末で enroll を済ませておく。
# 資格情報のファイルは、サービスを動かす利用者だけが読める場所へ置く。
param(
  [Parameter(Mandatory = $true)][string] $NodePath,
  [Parameter(Mandatory = $true)][string] $AgentRoot,
  [string] $ServiceName = 'StaffWeaveAgent',
  [string] $Store = 'C:\ProgramData\StaffWeave\agent.json'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $NodePath)) { throw "Node.js が見つかりません: $NodePath" }
if (-not (Test-Path $AgentRoot)) { throw "配布物が見つかりません: $AgentRoot" }

$cli = Join-Path $AgentRoot 'packages/agent/src/cli.ts'
$binaryPath = "`"$NodePath`" `"$cli`" serve --store `"$Store`""

sc.exe create $ServiceName binPath= $binaryPath start= auto | Out-Null
# 落ちたら間を空けて上げ直す。上げ続けると、直らない不具合で電源を使い切る。
sc.exe failure $ServiceName reset= 86400 actions= restart/30000/restart/60000/restart/300000 | Out-Null
sc.exe description $ServiceName "StaffWeave 打刻端末の送信待ちを送り続けます" | Out-Null

Write-Host "登録しました: $ServiceName"
Write-Host "開始するには: sc.exe start $ServiceName"
PS1

cat > "${OUTPUT}/staffweave-agent/uninstall-service.ps1" <<'PS1'
# StaffWeave の打刻 Agent のサービス登録を外す。
#
# 資格情報と送信待ちのファイルは消さない。送れていない打刻が残っている可能性があるため、
# 消すかどうかは docs/operations/device-agent-service.md の手順で確かめてから決める。
param([string] $ServiceName = 'StaffWeaveAgent')

$ErrorActionPreference = 'Stop'

sc.exe stop $ServiceName | Out-Null
sc.exe delete $ServiceName | Out-Null

Write-Host "登録を外しました: $ServiceName"
Write-Host "資格情報と送信待ちのファイルは残しています。"
PS1

cp "${ROOT}/docs/operations/device-agent-service.md" "${OUTPUT}/staffweave-agent/README.md"

echo "作成しました: ${OUTPUT}/staffweave-agent"
