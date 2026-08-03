# ドキュメント

## 使う

| 文書 | 内容 |
| --- | --- |
| [features.md](guide/features.md) | 現在の状態と、実際に動作する機能 |
| [getting-started.md](guide/getting-started.md) | ローカルでの起動、初期化、稼働確認、デモ用データ |
| [device-agent.md](guide/device-agent.md) | 打刻端末・IC カード・Agent の資格情報の扱い |
| [integrations.md](guide/integrations.md) | API キー、CSV の入出力、Webhook |

## 運用する

| 文書 | 内容 |
| --- | --- |
| [deployment.md](operations/deployment.md) | Docker での起動、公開前の設定、ホストへの公開範囲 |
| [operations.md](operations/backup.md) | バックアップと復元 |
| [performance.md](development/performance.md) | 問い合わせ回数と索引の決めごと |

## 開発する

| 文書 | 内容 |
| --- | --- |
| [development-policy.md](development/policy.md) | 設計の前提・技術選定・守るべき制約 |
| [module-boundaries.md](development/architecture.md) | パッケージ構成と依存方向 |
| [glossary.md](development/glossary.md) | 日英用語集（識別子・API・DB 名の基準） |
| [testing.md](development/testing.md) | 検証コマンドと、テスト用データベースの扱い |

## セキュリティ

| 文書 | 内容 |
| --- | --- |
| [security/authentication.md](security/authentication.md) | パスワード変更、セッションの期限、ログイン試行の制限 |
| [security/http-hardening.md](security/http-hardening.md) | 応答ヘッダー、送信元の検査、要求本文の上限 |
| [security/webhook-target-policy.md](security/webhook-target-policy.md) | Webhook 送信先のネットワーク方針 |
| [security/webhook-signing.md](security/webhook-signing.md) | Webhook 署名鍵の保存と検証手順 |
| [security/card-fingerprint-key.md](security/card-fingerprint-key.md) | IC カード指紋鍵の設定と Workspace ごとの分離 |
| [security/csv-output.md](security/csv-output.md) | CSV 出力の無害化と、取り込み側から見える差 |
| [security/employee-data-access.md](security/employee-data-access.md) | 従業員データの閲覧範囲 |
| [security/sbom.md](security/sbom.md) | 配布物の構成一覧（SBOM）の対象と読み方 |

## 記録

| 文書 | 内容 |
| --- | --- |
| [decisions/](decisions/) | 実装からは読み取れない判断の記録（ライセンスなど） |

実装の進行状態はここに書きません。要求と完了条件は GitHub Issue、
実装差分と検証結果は Pull Request、機械的な合否は CI を正本とします。
