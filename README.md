# staffweave

セルフホスト可能な勤怠管理基盤（開発中）。

打刻・IC カード・PC セッションなどの記録を上書きされない観測イベントとして保存し、
そこから計算・申請・承認を経て確定値を作ります。

正式リリース・実運用投入判定を満たしました（2026-08-02 時点、正本は
[docs/roadmap.md](docs/roadmap.md)）。法令への適合、無停止運用、脆弱性が無いことは保証しません。

## ドキュメント

説明はすべて [docs/](docs/README.md) にあります。README には写しません。

| 目的 | 文書 |
| --- | --- |
| 何が動くのか知る | [docs/features.md](docs/features.md) |
| 手元で起動する | [docs/getting-started.md](docs/getting-started.md) |
| 打刻端末と IC カードを試す | [docs/device-agent.md](docs/device-agent.md) |
| API キー・CSV・Webhook を使う | [docs/integrations.md](docs/integrations.md) |
| Docker で配置する | [docs/deployment.md](docs/deployment.md) |
| バックアップと復元を行う | [docs/operations.md](docs/operations.md) |
| 変更を検証する | [docs/testing.md](docs/testing.md) |
| 実装の決めごとを知る | [docs/development-policy.md](docs/development-policy.md) |
| 全文書を一覧する | [docs/README.md](docs/README.md) |

## 免責

staffweave は不正打刻の完全な防止や、特定の国・地域の労働法令への適合を保証しません。
運用にあたっては、利用者自身の責任で法令および社内規程との整合性を確認してください。

## ライセンス

MIT License. [LICENSE](LICENSE) を参照してください。
サーバー、Web UI、Agent、connector SDK、CLI、スクリプト、リポジトリ内のドキュメントを
すべて含みます。採用の背景と見直す条件は
[docs/decisions/0001-mit-license.md](docs/decisions/0001-mit-license.md) にあります。
