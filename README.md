# StaffWeave

セルフホスト可能な勤怠管理基盤（開発中）。

打刻・IC カード・PC セッションなどの記録を上書きされない観測イベントとして保存し、
そこから計算・申請・承認を経て確定値を作ります。

## ドキュメント

説明はすべて **[docs/](docs/README.md)** にあります。README には写しません。
索引を二か所に置くと、文書を足したときに片方が古くなります。

まず読むなら [何が動くのか](docs/guide/features.md) と
[手元での起動](docs/guide/getting-started.md) です。

## 免責

StaffWeave は不正打刻の完全な防止や、特定の国・地域の労働法令への適合を保証しません。
運用にあたっては、利用者自身の責任で法令および社内規程との整合性を確認してください。

## ライセンス

MIT License. [LICENSE](LICENSE) を参照してください。
サーバー、Web UI、Agent、connector SDK、CLI、スクリプト、リポジトリ内のドキュメントを
すべて含みます。採用の背景と見直す条件は
[docs/decisions/0001-mit-license.md](docs/decisions/0001-mit-license.md) にあります。
