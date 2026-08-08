# 開発に参加する

Issue も Pull Request も歓迎します。大きな変更は、先に Issue で相談してください。

## 手元で動かす

手順は [getting-started.md](docs/guide/getting-started.md) にあります。

## 変更したら

```sh
pnpm check      # lint、型検査、単体テスト。DB は要りません
```

これで足りない場合だけ、変更した範囲に応じて足してください。

| 変更したもの | 追加で流すもの |
| --- | --- |
| API・ドメイン・DB | `pnpm test:integration`（PostgreSQL が要ります） |
| マイグレーション | `pnpm db:migrate` と `pnpm db:verify` |
| 画面 | `pnpm test:e2e` |

残りは PR の CI が確かめます。手元ですべてを再現できなくても構いません。
テストの書き方と、CI がどう分かれているかは
[testing.md](docs/development/testing.md) にあります。

## 変更するときに気を付けること

- パッケージの依存の向きは [architecture.md](docs/development/architecture.md) が決めています。
  逆向きの依存は CI が落とします。
- 打刻などの観測イベントは書き換えません。訂正は追記で表します。
- Repository は `workspaceId` を必ず受け取り、SQL の `WHERE` 句に含めます。
- 適用済みのマイグレーションは書き換えず、新しい番号で足します。
- 日本語と英語の名前の対応は [glossary.md](docs/development/glossary.md) にあります。

## Pull Request

- 1 つの PR で 1 つのことを扱ってください。
- 何を直したかと、なぜそうしたかを本文へ書いてください。
- 壊れうる振る舞いを直したときは、それを固定するテストも一緒に。
