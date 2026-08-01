# モジュール境界

staffweave は pnpm workspace 上のモジュラーモノリスです。
パッケージは必要になったフェーズで追加します。将来用の空パッケージは作りません。

## 依存方向

```
domain     ──▶ (fsmxjs のみ)
db         ──▶ (なし)
contracts  ──▶ domain
web        ──▶ contracts, domain
agent      ──▶ contracts, domain
connector  ──▶ contracts, domain
api        ──▶ contracts, domain, db
```

逆方向の依存を作らないこと。`domain` と `db` は他のワークスペースパッケージへ依存しません。

`api` は試験用に `agent` と `connector` を `devDependencies` で使います。
端末の署名と Webhook の検証を、実際に相手側が使う実装で確かめるためです。
本体の実行には含めません。

この表は `pnpm check:policy` が `package.json` と突き合わせて検査します。
依存を増やすときは、この文書と検査の両方を更新してください。

### `domain` を `api` の外で使うとき

`web` / `agent` / `connector` が `domain` に依存するのは意図した設計です。
同じ計算を二度書くと、画面と端末とサーバーで結果が食い違います。

使ってよいもの:

- 値オブジェクトと型（業務日、時刻、分数、期間、ロケール）
- 引数だけで決まる純粋な計算（業務日の判定、正規化、署名対象の組み立て、指紋の計算）
- 表示のための判定（次に押せる打刻、乖離の分類）

使わないもの:

- 業務の判断を確定させる目的での状態遷移。申請・承認・締め・端末登録の結果は
  サーバーが決めます。画面や端末での判定は表示の先読みであり、正本ではありません。
- 権限の判定を根拠に、サーバー側の検査を省くこと。画面の出し分けに使うのは構いませんが、
  実際の可否は毎回サーバーが決めます。

## 各パッケージの責務

### `@staffweave/domain`

勤怠の意味そのものを持つ層。純粋な TypeScript のみ。

- 値オブジェクト（勤務日、時刻、分数、期間）
- 打刻イベントから勤務実績を導く決定的な計算
- 申請・承認・締め・端末登録の状態遷移（fsmxjs）
- 権限判定のルール

置かないもの: HTTP、SQL、React、環境変数、時刻の暗黙取得（`Date.now()` は引数で受け取る）。

### `@staffweave/contracts`

Web・Agent・外部連携の共通契約。

- OpenAPI 3.1 文書
- JSON Schema
- そこから導かれる TypeScript 型

実装を持たず、契約と検証だけを持ちます。

### `@staffweave/db`

PostgreSQL 接続層。ワークスペースの他のパッケージへは依存しません。

- SQL マイグレーション（連番付き `.sql`）
- 接続管理とトランザクション
- 明示的な SQL を実行する最小のインターフェース（`Database` / `Queryable`）

PostgreSQL ドライバの型はこのパッケージの外へ出しません。
Repository の定義と実装は、それを使うユースケースと同じ場所（`api` の機能ディレクトリ）に置きます。
SQL を離れた場所に置くと、どのクエリがどのユースケースのものか追えなくなるためです。

### `@staffweave/api`

Hono による HTTP サーバー。

- ユースケース（アプリケーションサービス）
- ルーティング、認証、認可、入力検証
- Repository の定義と SQL 実装

ここが唯一、`domain` と `db` を組み合わせる場所です。
機能ディレクトリは `identity` / `organization` のように業務の単位で分け、
それぞれが `repository.ts`（永続化）、`service.ts`（ユースケース）、`routes.ts`（HTTP）を持ちます。
すべての Repository メソッドは `workspaceId` を必須引数として受け取り、SQL の `WHERE` 句へ必ず含めます。

例外は背景処理です。マイグレーションと Webhook 送信ワーカーは利用者の要求ではないため、
Workspace をまたいで走査します。取り出した行は `workspace_id` を保持し、
以後の問い合わせではそれを境界として使います。

機能どうしを直接つながないため、副作用の境界は小さな port として `shared/` に置きます。
承認モジュールは Webhook の実装を知らず、`NotificationOutbox` へ出来事を積むだけです。
実際の送信先の検索・署名・HTTP 通信は `integration` の adapter が持ちます。

### `@staffweave/web`

React + Vite のブラウザアプリケーション。

- 従業員向け画面と管理者向け画面
- `ja-JP` / `en` の切り替え
- API クライアントは `contracts` の型を使う
- 表示のための計算は `domain` を呼ぶ

ドメイン計算をここで再実装しないこと。判断の正本は常にサーバー側です。

### `@staffweave/agent`

打刻端末の Agent とシミュレーター。

- 端末の鍵生成と登録
- 署名付きイベントの送信と再送
- 実機を用意せずに取り決めを確認できる CLI

秘密鍵は Agent 側にのみ置き、サーバーへは公開鍵だけを渡します。
OS 固有実装はこのリポジトリに含めません。

### `@staffweave/connector`

外部連携を作るための最小の道具立て。

- API キーでの読み取り
- 登録時の秘密からの署名鍵の導出
- Webhook の署名検証

便利さより、送信側と受信側で計算が食い違わないことを優先します。

## 命名

- パッケージ名は `@staffweave/<name>`。
- ディレクトリは `packages/<name>`。
- 内部モジュールは機能単位（`attendance`, `organization`, `approval`）で分け、
  技術レイヤー単位（`models`, `utils`）では分けません。
