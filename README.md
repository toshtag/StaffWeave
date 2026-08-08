# StaffWeave

勤怠管理のシステムです。SaaS ではなく、自分たちのサーバーに置いて動かします。

出勤・退勤の打刻から、勤務時間の計算、申請と承認、月末の締めまでを扱います。
打刻はブラウザ、スマートフォン、据え置きの打刻端末と IC カードから行えます。

**リリース候補です。** 実機・第三者・試行運用の確認が済んでいないため、
正式リリースはしていません。

## 動かしてみる

Node.js 22.12 以上、pnpm 11、Docker が要ります。

```sh
pnpm install
cp .env.example .env
docker compose up -d db                             # PostgreSQL
pnpm db:migrate
pnpm bootstrap --email admin@example.com            # 最初の管理者。パスワードは一度だけ表示
pnpm dev                                            # API 8787 / 画面 5173
```

`pnpm seed:demo` で架空のデータが入り、ひととおりの画面を見られます。

Docker だけで動かす場合や、初期パスワードを自分で決める場合は
[手元で動かす手順](docs/guide/getting-started.md)を見てください。

## できること

- 打刻と訂正
- 勤務時間の計算
- 休暇の管理
- 申請と承認
- 月次の締めと給与連携
- 打刻端末と IC カード
- 外部連携（CSV、API キー、Webhook）

いま動くものと、まだ無いものは[できること](docs/guide/features.md)にあります。

## ドキュメント

[docs/](docs/README.md) にあります。版ごとの変更は[変更の記録](CHANGELOG.md)。
開発に参加する場合は[はじめての変更](CONTRIBUTING.md)から読んでください。

## 免責

不正打刻を完全に防ぐ仕組みではありません。
労働法令や社内の規程に合っているかは、導入する側で確認してください。

## ライセンス

MIT License です（[LICENSE](LICENSE)）。リポジトリの中身はすべて含みます。
