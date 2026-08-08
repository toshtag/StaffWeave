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

# 読み取り装置の部品。組み立てが要るため、動かす OS の上でしか作れない。
# 指定されたときだけ同梱する。Windows 向けの配布物を組むときに渡す。
READER_MODULE="${AGENT_READER_MODULE-}"

# 対応する Node の版。組み立てた部品は、この版の ABI に合わせて作られる。
# 別の版で動かすと、読み込みの時点で落ちる。
NODE_MAJOR=$(cd "$ROOT" && cat .nvmrc | tr -d '[:space:]')

# 同梱する他所の部品。版はリポジトリの lockfile と合わせる。
# ずれると、確かめた組み合わせと配るものが別になる。
FSMXJS_VERSION="1.5.0"
AJV_VERSION="8.20.0"
AJV_FORMATS_VERSION="3.0.1"

rm -rf "$OUTPUT"
mkdir -p "$BUNDLE"

# 作業場はリポジトリの中へ置く。外（mktemp）へ置くと、Windows の Git Bash では
# tsc へ渡す道と、そのあと読む道の書き方が食い違い、出来上がったものを見失う。
WORK="$ROOT/.package-agent-work"
rm -rf "$WORK"
mkdir -p "$WORK"

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
    "outDir": "./.package-agent-work/out",
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
  "engines": { "node": ">=$NODE_MAJOR <$((NODE_MAJOR + 1))" },
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
  "sourceSha": "$SOURCE_SHA",
  "nodeMajor": "$NODE_MAJOR",
  "reader": "$READER_MODULE"
}
JSON

echo '要る部品を取り寄せます'
# 取り寄せはここで済ませる。現場の端末は通信できないことがある。
# 版は上で固定しているため、取り寄せるたびに中身が変わることはない。
(cd "$BUNDLE" && npm install --omit=dev --no-audit --no-fund --loglevel=error > /dev/null)
# 取り寄せの記録は配らない。中身は package.json と同梱の node_modules が示す。
rm -f "$BUNDLE/package-lock.json"

# 読み取り装置の部品は、組み立てが要る。組み立て済みのものを別の OS で作れないため、
# 動かす OS の上で組むときにだけ入れる。端末では取り寄せない。現場の端末は
# 通信できないことがあり、組み立ての道具も無い。
if [ -n "$READER_MODULE" ]; then
  echo "読み取り装置の部品を組み込みます（$READER_MODULE）"
  (cd "$BUNDLE" && npm install --omit=dev --no-audit --no-fund --loglevel=error "$READER_MODULE")
  rm -f "$BUNDLE/package-lock.json"
  # 組み立てた結果が入っていることを、ここで確かめる。無いまま配ると、
  # 端末の前で初めて読めないと分かる。
  if ! find "$BUNDLE/node_modules" -name '*.node' | head -1 | grep -q . ; then
    echo '読み取り装置の部品を組み立てられませんでした。' >&2
    exit 1
  fi
fi

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

# 端末の起動時に常駐させる手順。実行はしない。実行すると、この場の権限で登録される。
#
# Windows のサービスとしては登録しない。サービスとして動くプロセスは SCM と話す
# 入口を持っている必要があり、node.exe も私たちの cli.js も持っていない。
# 詳しくは docs/decisions/0002-windows-residency.md。
cat > "$BUNDLE/install-startup.ps1" <<'PS1'
# StaffWeave の打刻 Agent を、端末の起動時に常駐させる。
#
# 管理者として実行すること。登録の前に、この端末で enroll を済ませておく。
# 資格情報のファイルは、動かす利用者だけが読める場所へ置く。
#
# Windows のサービスとしては登録しない（docs/decisions/0002-windows-residency.md）。
# 求めているのは起動時の自動常駐で、サービスの一覧に出ること自体ではない。
#
# 読み取り装置を付けない端末では -NoReader を付ける。
param(
  [Parameter(Mandatory = $true)][string] $NodePath,
  [Parameter(Mandatory = $true)][string] $AgentRoot,
  [string] $TaskName = 'StaffWeaveAgent',
  [string] $Store = 'C:\ProgramData\StaffWeave\agent.json',
  [switch] $NoReader
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $NodePath)) { throw "Node.js が見つかりません: $NodePath" }
if (-not (Test-Path $AgentRoot)) { throw "配布物が見つかりません: $AgentRoot" }

# 起動するのはコンパイル済みの JS。Node は .ts を読めない。
$cli = Join-Path $AgentRoot 'agent/cli.js'
if (-not (Test-Path $cli)) { throw "配布物が壊れています。agent/cli.js がありません: $cli" }

# 渡された Node の版が、この配布物に合っているかを先に確かめる。
# 合わない版で登録すると、端末の再起動まで気付かず、上がっては落ちを繰り返す。
$build = Join-Path $AgentRoot 'agent/build-info.json'
if (Test-Path $build) {
  $expected = (Get-Content $build -Raw | ConvertFrom-Json).nodeMajor
  if ($expected) {
    $actual = (& $NodePath -p 'process.versions.node.split(".")[0]').Trim()
    if ($actual -ne $expected) {
      throw "この配布物は Node $expected 用です（渡された Node は $actual）。対応する版を指してください。"
    }
  }
}

# 読み取りと送信を 1 つのプロセスで持つ。分けると、登録した側だけが動く。
$mode = if ($NoReader) { 'serve' } else { 'station' }

$action = New-ScheduledTaskAction -Execute $NodePath `
  -Argument "`"$cli`" $mode --store `"$Store`"" -WorkingDirectory $AgentRoot

# 端末の起動時に始める。利用者のログオンは待たない。据え置きの端末は
# 誰もログオンしないまま置かれる。
$trigger = New-ScheduledTaskTrigger -AtStartup

# SYSTEM として動かす。ログオンしている利用者に依存させない。
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount `
  -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd `
  -MultipleInstances IgnoreNew `
  -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3 `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "登録しました: $TaskName（$mode）"
Write-Host "開始するには: Start-ScheduledTask -TaskName $TaskName"
Write-Host "状態を見るには: Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
PS1

cat > "$BUNDLE/uninstall-startup.ps1" <<'PS1'
# StaffWeave の打刻 Agent の常駐を外す。
#
# 資格情報と送信待ちのファイルは消さない。送れていない打刻が残っている可能性があるため、
# 消すかどうかは README の手順で確かめてから決める。
param(
  [string] $TaskName = 'StaffWeaveAgent',
  [Parameter(Mandatory = $true)][string] $NodePath,
  [Parameter(Mandatory = $true)][string] $AgentRoot,
  [string] $Store = 'C:\ProgramData\StaffWeave\agent.json',
  [int] $StopTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

# まず行儀よく終わらせる。タスクスケジューラの停止はプロセスを強制的に
# 終わらせるだけで、Windows には「行儀よく終われ」という合図が無い。
$cli = Join-Path $AgentRoot 'agent/cli.js'
if (Test-Path $cli) {
  & $NodePath $cli stop --store $Store
  $deadline = (Get-Date).AddSeconds($StopTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $info = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $info -or $info.State -ne 'Running') { break }
    Start-Sleep -Seconds 1
  }
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "常駐を外しました: $TaskName"
Write-Host "資格情報と送信待ちのファイルは残しています。"
PS1

cp "$ROOT/docs/operations/device-agent-service.md" "$BUNDLE/README.md"

echo "作成しました: $BUNDLE"
