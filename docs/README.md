# ドキュメント

読み手ごとにディレクトリを分けています。

## guide/ — 使う

| 文書 | 内容 |
| --- | --- |
| [features.md](guide/features.md) | いま動くものと、まだ無いもの |
| [getting-started.md](guide/getting-started.md) | ローカルでの起動、初期化、稼働確認、デモ用データ |
| [device-agent.md](guide/device-agent.md) | 打刻端末・IC カード・Agent の資格情報の扱い |
| [integrations.md](guide/integrations.md) | API キー、CSV の入出力、Webhook |

## operations/ — 運用する

| 文書 | 内容 |
| --- | --- |
| [deployment.md](operations/deployment.md) | Docker での起動、公開前の設定、ホストへの公開範囲 |
| [backup.md](operations/backup.md) | バックアップと復元 |

## development/ — 手を入れる

| 文書 | 内容 |
| --- | --- |
| [policy.md](development/policy.md) | 設計の前提・技術選定・守るべき制約 |
| [architecture.md](development/architecture.md) | パッケージ構成と依存方向 |
| [glossary.md](development/glossary.md) | 日英用語集（識別子・API・DB 名の基準） |
| [testing.md](development/testing.md) | 検証コマンドと、テスト用データベースの扱い |
| [performance.md](development/performance.md) | 問い合わせ回数と索引の決めごと |

## security/ — 前提を確かめる

| 文書 | 内容 |
| --- | --- |
| [authentication.md](security/authentication.md) | パスワード変更、セッションの期限、ログイン試行の制限 |
| [http-hardening.md](security/http-hardening.md) | 応答ヘッダー、送信元の検査、本文の上限、認証なしで答える経路 |
| [employee-data-access.md](security/employee-data-access.md) | 誰の従業員データを誰が取得できるか |
| [webhook-target-policy.md](security/webhook-target-policy.md) | Webhook 送信先のネットワーク方針 |
| [webhook-signing.md](security/webhook-signing.md) | Webhook 署名鍵の保存と検証手順 |
| [card-fingerprint-key.md](security/card-fingerprint-key.md) | IC カード指紋鍵の設定と Workspace ごとの分離 |
| [csv-output.md](security/csv-output.md) | CSV 出力の無害化と、取り込み側から見える差 |
| [sbom.md](security/sbom.md) | 配布物の構成一覧（SBOM）の対象と読み方 |

## decisions/ — 判断を辿る

コードを読んでも分からない判断の記録です。ライセンスや、データベースの並びをどう決めたかなど。
一覧は [decisions/](decisions/) にあります。

いま何を作っているかは、GitHub の Issue と Pull Request を見てください。
