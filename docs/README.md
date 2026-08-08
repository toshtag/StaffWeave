# ドキュメント

目的から入ってください。ここに載っていない文書もあります。
深いところは、必要な文書からリンクしています。

## はじめる

- [guide/getting-started.md](guide/getting-started.md) — 手元で動かすまでの手順。初期設定とデモ用データ
- [guide/features.md](guide/features.md) — いま動くものと、まだ無いもの

## 使う

- [guide/integrations.md](guide/integrations.md) — API キー、CSV、Webhook
- [guide/device-agent.md](guide/device-agent.md) — 打刻端末と IC カードを、実機なしで試す
- [product/work-category-fields.md](product/work-category-fields.md) — 勤務区分の設定が、予定・計算・表示のどこへ効くか
- [product/work-category-precedence.md](product/work-category-precedence.md) — 勤務パターン・勤務予定・勤務区分で重なる設定の優先順位

## 運用する

- [operations/deployment.md](operations/deployment.md) — Docker で立てる。公開する前にやること
- [operations/backup.md](operations/backup.md) — バックアップと復元
- [operations/retention.md](operations/retention.md) — どのデータをいつまで持つか。消してはいけないもの
- [operations/device-agent-service.md](operations/device-agent-service.md) — 打刻端末の常駐と、実機で確かめること

## 開発に参加する

- [CONTRIBUTING.md](../CONTRIBUTING.md) — セットアップから PR まで
- [development/architecture.md](development/architecture.md) — 前提、パッケージの構成、依存してよい向き
- [development/testing.md](development/testing.md) — 検証コマンドと、テストの書き方
- [development/glossary.md](development/glossary.md) — 日本語と英語の対応表

## 設計とセキュリティを詳しく見る

- [decisions/](decisions/) — コードを読んでも分からない判断の記録（ADR）
- [security/](security/) — 認証とセッション、応答ヘッダー、閲覧範囲、Webhook の宛先と署名、
  IC カードの指紋鍵、CSV の出力、SBOM

## 配る

- [release/checklist.md](release/checklist.md) — リリース候補と正式リリースの判定

個々の課題がいまどこまで進んでいるかは、GitHub の Issue と Pull Request を見てください。
