# staffweave

セルフホスト可能な勤怠管理基盤（開発中）。

staffweave は、従業員の勤務実績を「観測された事実」と「人が確定させた記録」に分けて扱う勤怠管理システムです。
打刻・ICカード・PC セッションなどの記録は上書きされない観測イベントとして保存し、
そこから計算・申請・承認を経て確定値を作ります。

## 現在の状態

**P2（組織と認証）完了時点。**

動作するもの:

- ワークスペース、組織、拠点、部門、従業員の登録と一覧
- メールアドレスとパスワードによるログイン、セッション、ログアウト
- ロールによる権限制御（ワークスペース管理者 / 組織管理者 / 従業員）
- 日本語と英語の切り替え

まだ無いもの: 打刻、勤務時間の計算、申請・承認、締め。
ロードマップと各フェーズの範囲は [docs/roadmap.md](docs/roadmap.md) を参照してください。

このリポジトリは、未実装の機能を「提供済み」として記載しません。
README に書かれている機能は、その時点で実際に動作するものだけです。

## ローカルでの起動

### 必要なもの

- Node.js 22.11 以上（`.nvmrc` は 24）
- pnpm 11
- Docker（PostgreSQL 用）

### 手順

```sh
# 1. 依存をインストール
pnpm install

# 2. 環境変数を用意
cp .env.example .env

# 3. PostgreSQL を起動（ホスト側ポートは既定で 5433）
docker compose up -d db

# 4. マイグレーションを適用
pnpm db:migrate

# 5. ワークスペースと最初の管理者を作成（初期パスワードが一度だけ表示されます）
pnpm bootstrap --email admin@example.com

# 6. API と Web を同時に起動
pnpm dev
```

- API: http://127.0.0.1:8787
- Web: http://127.0.0.1:5173（`/api` は API へプロキシされます）

稼働確認:

```sh
curl http://127.0.0.1:8787/api/health        # プロセスの生存確認
curl http://127.0.0.1:8787/api/ready         # DB 接続とマイグレーション適用状況
curl http://127.0.0.1:8787/api/openapi.json  # API 契約（OpenAPI 3.1）
```

### 検証

```sh
pnpm verify            # lint + typecheck + 全テスト
pnpm test:unit         # 単体テストのみ（DB 不要）
pnpm test:integration  # 統合テストのみ（DB 必要）
```

統合テストは `TEST_DATABASE_URL` のデータベースを使い、実行のたびにデータを消去します。
開発用データベースを誤って指さないよう、名前が `_test` で終わることを実行時に検査します。

## 設計の前提

- **セルフホスト優先。** 単一の PostgreSQL と Docker Compose で起動できることを最優先にします。
  同一コードベースで将来 SaaS 運用できるよう、Workspace 分離は最初から持ちます。
- **モジュラーモノリス。** マイクロサービス、Kubernetes、Redis、Kafka は導入しません。
- **観測イベントは不変。** 打刻の取り消しや修正は、元イベントを書き換えず追加記録で表現します。
- **自動確定しない。** PC ログや IC カードの記録だけで勤務時間を確定させません。
  これらは証拠・候補・乖離検出として扱います。

## 免責

staffweave は不正打刻の完全な防止や、特定の国・地域の労働法令への適合を保証しません。
運用にあたっては、利用者自身の責任で法令および社内規程との整合性を確認してください。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [docs/development-policy.md](docs/development-policy.md) | 開発方針・技術選定・守るべき制約 |
| [docs/module-boundaries.md](docs/module-boundaries.md) | パッケージ構成と依存方向 |
| [docs/glossary.md](docs/glossary.md) | 日英用語集（識別子・API・DB 名の基準） |
| [docs/roadmap.md](docs/roadmap.md) | P0〜P14 のロードマップ |

## ライセンス

MIT License. [LICENSE](LICENSE) を参照してください。
