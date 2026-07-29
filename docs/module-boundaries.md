# モジュール境界

staffweave は pnpm workspace 上のモジュラーモノリスです。
パッケージは必要になったフェーズで追加します。将来用の空パッケージは作りません。

## 依存方向

```
web ──▶ contracts
api ──▶ contracts, domain, db
db  ──▶ domain
domain ──▶ (fsmxjs のみ)
```

逆方向の依存を作らないこと。`domain` は他のどのパッケージにも依存しません。

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

PostgreSQL 接続層。

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

### `@staffweave/web`

React + Vite のブラウザアプリケーション。

- 従業員向け画面と管理者向け画面
- `ja-JP` / `en` の切り替え
- API クライアントは `contracts` の型を使う

ドメイン計算をここで再実装しないこと。

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
- Webhook の署名検証

便利さより、送信側と受信側で計算が食い違わないことを優先します。

## 命名

- パッケージ名は `@staffweave/<name>`。
- ディレクトリは `packages/<name>`。
- 内部モジュールは機能単位（`attendance`, `organization`, `approval`）で分け、
  技術レイヤー単位（`models`, `utils`）では分けません。
