# ドキュメント

## 製品 — `product/`

| 文書 | 内容 |
| --- | --- |
| [product/capability-matrix.md](product/capability-matrix.md) | 能力ごとの状態。動くもの、一部だけのもの、これから作るもの、作らないもの |
| [roadmap.md](roadmap.md) | どの順で作るかと、その順にする理由 |

## 使い方 — `guide/`

| 文書 | 内容 |
| --- | --- |
| [features.md](guide/features.md) | いま動くものと、まだ無いもの |
| [getting-started.md](guide/getting-started.md) | 手元で動かすまでの手順。初期設定とデモ用データ |
| [device-agent.md](guide/device-agent.md) | 打刻端末と IC カードを実機なしで試す。資格情報の置き方 |
| [integrations.md](guide/integrations.md) | API キー、CSV、Webhook の使い方 |

## 運用 — `operations/`

| 文書 | 内容 |
| --- | --- |
| [deployment.md](operations/deployment.md) | Docker で立てる。公開する前にやること |
| [backup.md](operations/backup.md) | バックアップと復元 |
| [device-agent-service.md](operations/device-agent-service.md) | 打刻端末の常駐、Windows サービス、実機で確かめること |

## 開発 — `development/`

| 文書 | 内容 |
| --- | --- |
| [policy.md](development/policy.md) | 迷ったときに優先する決めごと |
| [architecture.md](development/architecture.md) | パッケージの構成と、依存してよい向き |
| [glossary.md](development/glossary.md) | 日本語と英語の対応表。名前を付けるときに引く |
| [testing.md](development/testing.md) | 検証コマンドと、テストの書き方 |
| [performance.md](development/performance.md) | 問い合わせの回数を増やさないための決めごと |

## セキュリティ — `security/`

| 文書 | 内容 |
| --- | --- |
| [authentication.md](security/authentication.md) | パスワードの変更、セッションの期限、ログイン試行の制限 |
| [http-hardening.md](security/http-hardening.md) | 応答ヘッダー、送信元の検査、本文の上限、認証なしで答える経路 |
| [employee-data-access.md](security/employee-data-access.md) | 誰の勤怠を誰が見られるか |
| [webhook-target-policy.md](security/webhook-target-policy.md) | Webhook をどこへ送ってよいか |
| [webhook-signing.md](security/webhook-signing.md) | Webhook の署名鍵の作り方と扱い |
| [card-fingerprint-key.md](security/card-fingerprint-key.md) | IC カードの指紋鍵 |
| [csv-output.md](security/csv-output.md) | CSV を開いた表計算で数式が動かないようにする |
| [sbom.md](security/sbom.md) | 配布物に何が入っているか（SBOM） |

## 決定の記録 — `decisions/`

コードを読んでも分からない判断だけを残しています。
ライセンスや、データベースの並びをどう決めたかなど。一覧は [decisions/](decisions/)。

個々の課題がいまどこまで進んでいるかは、GitHub の Issue と Pull Request を見てください。
