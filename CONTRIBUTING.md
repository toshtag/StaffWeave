# 開発に参加する

Issue も Pull Request も歓迎します。大きな変更は、先に Issue で相談してください。

## 手元で動かす

手順は[手元で動かす](docs/guide/getting-started.md)にあります。

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
テストの書き方は[検証](docs/development/testing.md)にあります。

## 設計上の決まり

パッケージの依存の向き、ワークスペース境界、観測イベントを書き換えないことなどは
[アーキテクチャ](docs/development/architecture.md)にまとまっています。
依存の向きに反する変更は CI が落とします。

名前を付けるときは[用語](docs/development/glossary.md)を引いてください。

## Pull Request

- 1 つの PR で 1 つのことを扱ってください。
- 何を直したかと、なぜそうしたかを本文へ書いてください。
- 壊れうる振る舞いを直したときは、それを固定するテストも一緒に。
