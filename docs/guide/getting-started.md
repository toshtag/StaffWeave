# ローカルでの起動

手元の環境で API と画面を動かすまでの手順です。
最短の 6 コマンドは [README](../../README.md) にあります。ここでは各段階の補足を書きます。

Docker だけで動かす場合は [deployment.md](../operations/deployment.md) を参照してください。

## 必要なもの

- Node.js 22.12 以上（`.nvmrc` は 24）
- pnpm 11
- Docker（PostgreSQL 用）

## 手順

```sh
# 1. 依存をインストール
pnpm install

# 2. 環境変数を用意
cp .env.example .env

# 3. PostgreSQL を起動（ホスト側は既定で 127.0.0.1:5433 にだけ公開）
docker compose up -d db

# 4. マイグレーションを適用
pnpm db:migrate

# 5. ワークスペースと最初の管理者を作成
#    （端末があれば非表示で尋ね、無ければ生成して一度だけ表示します）
pnpm bootstrap --email admin@example.com

# 6. API と Web を同時に起動
pnpm dev
```

- API: http://127.0.0.1:8787
- Web: http://127.0.0.1:5173（`/api` は API へプロキシされます）

## 初期パスワードの渡し方

初期パスワードを自分で決める場合は、標準入力かファイルで渡します。

```sh
pnpm bootstrap --email admin@example.com --password-stdin < password.txt
pnpm bootstrap --email admin@example.com --password-file /run/secrets/admin
```

`--password` でも渡せますが、値がシェル履歴とプロセス一覧へ残るため将来やめます。

初期化時に表示されたパスワードは、画面の「パスワードの変更」から変えてください
（[security/authentication.md](../security/authentication.md)）。

## 稼働確認

```sh
curl http://127.0.0.1:8787/api/health        # プロセスの生存確認
curl http://127.0.0.1:8787/api/ready         # DB 接続とマイグレーション適用状況
curl http://127.0.0.1:8787/api/openapi.json  # API 契約（OpenAPI 3.1）
```

## デモ用データ

説明のための架空のデータを入れて、ひととおりの画面を確認できます。

```sh
pnpm seed:demo            # デモワークスペースを作る
pnpm seed:demo --reset    # 作り直す
```

作成される利用者とパスワードは実行時に表示されます。
すべて架空の値です。公開された場所では使わないでください。

## 次に読むもの

| 目的 | 文書 |
| --- | --- |
| 打刻端末と IC カードを試す | [device-agent.md](device-agent.md) |
| API キー・CSV・Webhook を使う | [integrations.md](integrations.md) |
| 変更を検証する | [testing.md](../development/testing.md) |
