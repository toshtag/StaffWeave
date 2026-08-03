# StaffWeave

勤怠管理のシステムです。SaaS ではなく、自分たちのサーバーに置いて動かします。まだ開発中です。

出勤・退勤の打刻から、勤務時間の計算、申請と承認、月末の締めまでを扱います。
打刻はスマートフォン、据え置きの打刻端末、IC カードから行えます。
PC のログイン・ログオフの記録も取り込めますが、これで勤務時間を決めることはしません。
打刻とずれていたら本人と管理者に見せるだけです。

打刻した記録は書き換えません。時刻を直すときは、元の記録を残したまま訂正を足します。
あとから「誰がいつ何を直したか」を辿れます。

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
[getting-started.md](docs/guide/getting-started.md) を見てください。

## ドキュメント

[docs/](docs/README.md) にあります。

## 免責

不正打刻を完全に防ぐ仕組みではありません。
労働法令や社内の規程に合っているかは、導入する側で確認してください。

## ライセンス

MIT License です（[LICENSE](LICENSE)）。リポジトリの中身はすべて含みます。
