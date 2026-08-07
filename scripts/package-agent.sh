#!/bin/sh
# 打刻端末の Agent を、そのまま動かせる形にまとめる。
#
#   ./scripts/package-agent.sh [出力先]
#
# TypeScript のまま配らない。Node は .ts を読めず、置いただけでは起動しない。
# ここでコンパイルし、出来上がった JS だけを配る。
#
# 動かすのに要る他所の部品は、まとめる時点で取り寄せて同梱する。
# 現場の端末は通信できないことがあり、置いてから取り寄せる形にはできない。
#
# 実行ファイルは作らない。署名と配布の方式が決まっていない今、
# 署名なしの実行ファイルが出回る。
set -eu

OUTPUT="${1:-artifacts/agent}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUNDLE="$OUTPUT/staffweave-agent"

# 版は root の package.json が正本。ここでは読むだけで、書き換えない。
# 配布物の中にも同じ版を書く。利用者へ直接渡るのは Agent 本体なので、
# そこが版を持たないと、診断・保守・問い合わせで「どの版か」を辿れない。
VERSION=$(cd "$ROOT" && node -p "require('./package.json').version")

# 元にした commit も 1 つだけ持たせる。取れない場所で組むこともあるため、
# 取れなければ空にする。空の値を書くより、項目ごと置かないほうが読み違えない。
SOURCE_SHA=$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null || echo '')

# 同梱する他所の部品。版はリポジトリの lockfile と合わせる。
# ずれると、確かめた組み合わせと配るものが別になる。
FSMXJS_VERSION="1.5.0"
AJV_VERSION="8.20.0"
AJV_FORMATS_VERSION="3.0.1"

rm -rf "$OUTPUT"
mkdir -p "$BUNDLE"

WORK=$(mktemp -d)

echo 'TypeScript をコンパイルします'

# 3 つのパッケージをまとめて 1 回で組む。
# 別々に組むと、パッケージ間の参照を組んだ後で繋ぎ直すことになる。
#
# 設定はリポジトリの中へ置く。外に置くと、型定義も他所の部品も
# リポジトリの node_modules から辿れなくなる。
CONFIG="$ROOT/.package-agent.tsconfig.json"
cleanup() {
  rm -rf "$WORK"
  rm -f "$CONFIG"
}
trap cleanup EXIT INT TERM

cat > "$CONFIG" <<JSON
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "noEmit": false,
    "declaration": false,
    "sourceMap": false,
    "outDir": "$WORK/out",
    "rootDir": "./packages",
    "paths": {
      "@staffweave/contracts": ["./packages/contracts/src/index.ts"],
      "@staffweave/domain": ["./packages/domain/src/index.ts"]
    }
  },
  "include": [
    "./packages/agent/src/**/*.ts",
    "./packages/contracts/src/**/*.ts",
    "./packages/domain/src/**/*.ts"
  ],
  "exclude": ["./packages/*/src/**/*.test.ts"]
}
JSON

(cd "$ROOT" && pnpm exec tsc -p "$CONFIG")

echo '起動できる形へ並べます'

# 入口は agent。他の 2 つは、Node が名前で辿れる場所へ置く。
mkdir -p "$BUNDLE/agent"
cp -R "$WORK/out/agent/src/." "$BUNDLE/agent/"

# 配布物そのものの package.json。要る部品だけを並べる。
cat > "$BUNDLE/package.json" <<JSON
{
  "name": "staffweave-agent",
  "version": "$VERSION",
  "private": true,
  "type": "module",
  "bin": { "staffweave-agent": "./agent/cli.js" },
  "dependencies": {
    "ajv": "$AJV_VERSION",
    "ajv-formats": "$AJV_FORMATS_VERSION",
    "fsmxjs": "$FSMXJS_VERSION"
  }
}
JSON

# 版と元の commit を、読み取り専用の 1 か所へ置く。package.json を実行時に読むと、
# 取り寄せの都合で書き換わったものを版として出しかねない。
cat > "$BUNDLE/agent/build-info.json" <<JSON
{
  "version": "$VERSION",
  "sourceSha": "$SOURCE_SHA"
}
JSON

echo '要る部品を取り寄せます'
# 取り寄せはここで済ませる。現場の端末は通信できないことがある。
# 版は上で固定しているため、取り寄せるたびに中身が変わることはない。
(cd "$BUNDLE" && npm install --omit=dev --no-audit --no-fund --loglevel=error > /dev/null)
# 取り寄せの記録は配らない。中身は package.json と同梱の node_modules が示す。
rm -f "$BUNDLE/package-lock.json"

# 自分たちのパッケージは、取り寄せのあとに置く。
# 先に置くと、npm が「依存に無いもの」として取り除く。
mkdir -p "$BUNDLE/node_modules/@staffweave"
for package in contracts domain; do
  target="$BUNDLE/node_modules/@staffweave/$package"
  mkdir -p "$target"
  cp -R "$WORK/out/$package/src/." "$target/"
  cat > "$target/package.json" <<JSON
{
  "name": "@staffweave/$package",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "exports": { ".": "./index.js" }
}
JSON
done

# サービスとして登録する手順。実行はしない。実行すると、この場の権限で登録される。
cat > "$BUNDLE/install-service.ps1" <<'PS1'
# StaffWeave の打刻 Agent を Windows サービスとして登録する。
#
# 管理者として実行すること。登録の前に、この端末で enroll を済ませておく。
# 資格情報のファイルは、サービスを動かす利用者だけが読める場所へ置く。
#
# 既定では、読み取り装置と送信を 1 つのサービスで動かす（station）。
# 分けると、登録した側だけが動き、もう一方は誰も起動しない。
# 読み取り装置を付けない端末では -NoReader を付ける。
param(
  [Parameter(Mandatory = $true)][string] $NodePath,
  [Parameter(Mandatory = $true)][string] $AgentRoot,
  [string] $ServiceName = 'StaffWeaveAgent',
  [string] $Store = 'C:\ProgramData\StaffWeave\agent.json',
  [switch] $NoReader
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $NodePath)) { throw "Node.js が見つかりません: $NodePath" }
if (-not (Test-Path $AgentRoot)) { throw "配布物が見つかりません: $AgentRoot" }

# 起動するのはコンパイル済みの JS。Node は .ts を読めない。
$cli = Join-Path $AgentRoot 'agent/cli.js'
if (-not (Test-Path $cli)) { throw "配布物が壊れています。agent/cli.js がありません: $cli" }

# 読み取りと送信を 1 つのプロセスで持つ。station は同梱の受け渡しを既定で読む。
$mode = if ($NoReader) { 'serve' } else { 'station' }
$binaryPath = "`"$NodePath`" `"$cli`" $mode --store `"$Store`""

sc.exe create $ServiceName binPath= $binaryPath start= auto | Out-Null
# 落ちたら間を空けて上げ直す。上げ続けると、直らない不具合で電源を使い切る。
sc.exe failure $ServiceName reset= 86400 actions= restart/30000/restart/60000/restart/300000 | Out-Null
sc.exe description $ServiceName "StaffWeave 打刻端末のカード読み取りと送信を行います" | Out-Null

Write-Host "登録しました: $ServiceName（$mode）"
Write-Host "開始するには: sc.exe start $ServiceName"
PS1

cat > "$BUNDLE/install-reader.ps1" <<'PS1'
# 読み取り装置の部品を、この端末へ入れる。
#
# 装置のドライバを叩く部分は OS ごとに組み立てが要る。組み立て済みのものを
# Linux で作って Windows へ配ることはできないため、端末の側で取り寄せる。
# 取り寄せるのはこの 1 つだけで、利用者がコードを書く必要はない。
#
# 管理者として実行すること。組み立てには Windows のビルドツールが要る。
param([string] $AgentRoot = $PSScriptRoot)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $AgentRoot 'package.json'))) {
  throw "配布物が見つかりません: $AgentRoot"
}

Push-Location $AgentRoot
try {
  npm install --omit=dev --no-audit --no-fund pcsclite@1.0.1
} finally {
  Pop-Location
}

Write-Host "読み取り装置の部品を入れました。"
Write-Host "確かめるには: node agent/cli.js diagnose"
PS1

cat > "$BUNDLE/uninstall-service.ps1" <<'PS1'
# StaffWeave の打刻 Agent のサービス登録を外す。
#
# 資格情報と送信待ちのファイルは消さない。送れていない打刻が残っている可能性があるため、
# 消すかどうかは README の手順で確かめてから決める。
param([string] $ServiceName = 'StaffWeaveAgent')

$ErrorActionPreference = 'Stop'

sc.exe stop $ServiceName | Out-Null
sc.exe delete $ServiceName | Out-Null

Write-Host "登録を外しました: $ServiceName"
Write-Host "資格情報と送信待ちのファイルは残しています。"
PS1

cp "$ROOT/docs/operations/device-agent-service.md" "$BUNDLE/README.md"

echo "作成しました: $BUNDLE"
