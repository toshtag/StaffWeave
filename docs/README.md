# ドキュメント

目的から入ってください。ここに載っていない文書もあります。
深いところは、必要な文書からリンクしています。

## はじめる

- [手元で動かす](guide/getting-started.md) — 起動までの手順、初期設定、デモ用データ
- [できること](guide/features.md) — いま動くものと、まだ無いもの

## 使う

- [外部とつなぐ](guide/integrations.md) — API キー、CSV、Webhook
- [打刻端末と IC カードを試す](guide/device-agent.md) — 実機なしで取り決めを確かめる
- [勤務区分の設定が効く場所](product/work-category-fields.md) — 予定・計算・表示のどこへ効くか
- [重なる設定の優先順位](product/work-category-precedence.md) — 勤務パターン・勤務予定・勤務区分

## 運用する

- [Docker で立てる](operations/deployment.md) — 公開する前にやること
- [バックアップと復元](operations/backup.md)
- [データの保持](operations/retention.md) — いつまで持つか、消してはいけないもの
- [打刻端末を常駐させる](operations/device-agent-service.md) — 導入手順と、実機で確かめること

## 開発に参加する

- [はじめての変更](../CONTRIBUTING.md) — セットアップから PR まで
- [アーキテクチャ](development/architecture.md) — 前提、パッケージの構成、依存してよい向き
- [検証](development/testing.md) — 検証コマンドと、テストの書き方
- [用語](development/glossary.md) — 日本語と英語の対応表

## 設計とセキュリティを詳しく見る

- [決定の記録](decisions/) — コードを読んでも分からない判断（ADR）
- [セキュリティの参照](security/) — 認証とセッション、応答ヘッダー、閲覧範囲、
  Webhook の宛先と署名、IC カードの指紋鍵、CSV の出力、SBOM

## リリースする

- [リリースの判定](release/checklist.md) — リリース候補と正式リリースの条件

個々の課題がいまどこまで進んでいるかは、GitHub の Issue と Pull Request を見てください。
