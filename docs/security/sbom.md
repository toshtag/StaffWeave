# SBOM

配布物に何が入っているかを、機械が読める形で示します。

SBOM は次を示すものではありません。

- 脆弱性が存在しないこと
- ライセンスの適合を法的に保証すること
- 依存が安全であること

示すのは構成だけです。依存 Advisory が出たときに、
自分が使っている版へ含まれるかを機械的に照合できるようにするためのものです。

## 二つの対象

対象の違う SBOM を、別のファイルとして書き出します。

| ファイル | 対象 | 含むもの |
| --- | --- | --- |
| `staffweave-workspace.cdx.json` | リポジトリと pnpm workspace | `@staffweave/*` の各パッケージ、npm の依存（開発・テスト用を含む）、GitHub Actions |
| `staffweave-container.cdx.json` | `docker/api.Dockerfile` から作る production コンテナ | Node.js のランタイム、production の npm パッケージ、OS パッケージ、イメージの中のファイル |

**一つへまとめません。** 開発時の依存と、実際に稼働するコンテナの中身は違います。
まとめると、どちらの話をしているのかが読めなくなり、
「開発用の道具が本番に入っている」といった誤読も起きます。

workspace の SBOM を production の構成として扱わないでください。逆も同じです。

## 生成と検証

```sh
pnpm sbom:generate   # 二つの SBOM とチェックサムを書き出す
pnpm sbom:verify     # CycloneDX の形式と、staffweave 固有の契約を確かめる
pnpm sbom:validate   # 形式の検証だけを行う
```

Docker が必要です。production コンテナを実際に構築してから読むためです。
`pnpm verify` には入れていません。通常の開発で Docker と外部の道具を必須にすると、
オフラインで検証できなくなり、変更の確認も遅くなります。
SBOM は専用の CI ジョブと、正式リリース前の確認で実行します。

書き出し先は `artifacts/sbom/` で、Git 管理しません。
SBOM は commit ごとに作り直します。古い SBOM を新しい commit の構成として使わないでください。

## 形式

| 項目 | 値 |
| --- | --- |
| 形式 | CycloneDX JSON |
| 仕様版 | 生成ツールが出力する版をそのまま使う（現在 1.7） |
| 生成 | Syft v1.50.0（`anchore/syft@sha256:1288ea4c…`） |
| 検証 | cyclonedx-cli 0.33.1（`cyclonedx/cyclonedx-cli@sha256:252c2e26…`） |

SPDX や XML は同時に出しません。形式を増やすと、検証・配布・差分の確認・
問い合わせへの対応がその分だけ増えます。要望が出た時点で判断します。

`specVersion` は手で書き換えません。生成ツールが出した版を、
そのまま検証ツールへ渡します。

道具は tag ではなく digest で固定します。tag は同じ名前のまま指す先が変わるため、
「どの版で作った SBOM か」を後から言えなくなります。

生成と検証で別々の実装を使います。「書き出せたから正しい」では、
形式が崩れていても気付けません。

## 読み方

| 項目 | 意味 |
| --- | --- |
| `components[].name` / `version` | 含まれているものと、その版 |
| `components[].purl` | 種別つきの識別子（`pkg:npm/...`、`pkg:apk/...`、`pkg:generic/node@...`） |
| `components[].type` | `library` / `application` / `operating-system` / `file` |
| `components[].licenses` | 生成ツールが読み取ったライセンス表記 |
| `dependencies` | どれがどれに依存しているか |
| `metadata.component` | その SBOM が何を対象にしているか |

Advisory と突き合わせるときは `purl` を使います。名前だけでは、
同名の別パッケージや、別のレジストリのものと区別できません。

## 秘密情報

生成物へ次が混ざっていないことを、生成のたびに確かめます。

- 検査用の目印（`SBOM_CANARY`）
- `DB_PASSWORD`、`CARD_FINGERPRINT_KEY`、接続文字列
- 生成した機械のホームディレクトリと、リポジトリの絶対パス

目印には実在しない値を使い、実在する秘密情報は検査へ使いません。

## チェックサム

`*.cdx.json.sha256` を並べて書き出します。中身はファイル名と digest だけで、
生成した機械の場所は入れません。配る相手には意味が無く、利用者名が漏れます。

## 配布

いまは CI の成果物（`staffweave-sbom-<commit SHA>`、保持 14 日）としてだけ取得できます。

正式リリース時の配布は決めていません。次を後続の工程で扱います。

- GitHub Release への添付
- コンテナレジストリへ push したイメージとの関連付け
- 署名付きの構成証明（`actions/attest`）

構成証明を今回作らないのは、署名する対象が決まっていないためです。
正式なリリース成果物がまだ無く、レジストリへ push もしていません。
CI で作る一時イメージへ恒久的な証明を付けても、配布物との関係が曖昧になります。

正式リリース工程では、署名の対象を次のいずれかへ固定します。

- リリース用コンテナイメージの digest
- 配布する archive
- Agent の配布バイナリ
- connector の npm パッケージ

## 対象外

- VEX（脆弱性の該当・非該当の表明）
- 脆弱性の自動修正
- ライセンス適合の法的判定
- Agent 単体の配布パッケージ、connector 単体の npm 公開物
