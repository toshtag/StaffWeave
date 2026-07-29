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

PostgreSQL アクセス層。

- SQL マイグレーション（連番付き `.sql`）
- 接続管理とトランザクション
- Repository 実装（明示的な SQL）

Repository のインターフェースは、それを使う側（`api`）が定義します。
すべての Repository メソッドは `workspaceId` を必須引数として受け取ります。

### `@staffweave/api`

Hono による HTTP サーバー。

- ユースケース（アプリケーションサービス）
- ルーティング、認証、認可、入力検証
- Repository インターフェースの定義

ここが唯一、`domain` と `db` を組み合わせる場所です。

### `@staffweave/web`

React + Vite のブラウザアプリケーション。

- 従業員向け画面と管理者向け画面
- `ja-JP` / `en` の切り替え
- API クライアントは `contracts` の型を使う

ドメイン計算をここで再実装しないこと。

### `@staffweave/agent`

端末・IC カード・PC セッションのシミュレーターと Agent 境界。

- 署名付きイベントの送信
- ローカルの再送キュー
- 実機非依存のテスト用アダプター

OS 固有実装はこのリポジトリに含めません。

## 命名

- パッケージ名は `@staffweave/<name>`。
- ディレクトリは `packages/<name>`。
- 内部モジュールは機能単位（`attendance`, `organization`, `approval`）で分け、
  技術レイヤー単位（`models`, `utils`）では分けません。
