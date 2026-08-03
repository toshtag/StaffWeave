# Docker での配置

Docker Compose だけで API と画面を動かす場合の手順と、公開するときの設定です。
手元での開発は [getting-started.md](getting-started.md) を参照してください。

## 起動

```sh
cp .env.example .env
docker compose --profile app up -d
docker compose exec app pnpm db:migrate
docker compose exec app pnpm bootstrap --email admin@example.com
```

`http://127.0.0.1:8787` で API と画面の両方が使えます。
`app` と同じイメージで `webhook-worker` も起動します。

実行用のイメージには、動かすのに必要なものだけが入ります。
開発用の依存とテストは含まれません。プロセスは非 root（`node`）で動きます。

## データベースの版

`docker compose` が起動する `db` が、動作を確かめている構成です。
版はここに書かず、`docker-compose.yml` の `db` を正本とします。
二か所へ書くと、必ず片方が古くなります。

外部の PostgreSQL へつなぐ場合は、`db` と同じ major に合わせてください。
`pnpm check:policy` は、`docker-compose.yml` と CI が同じ major を使っているかまでを見ます。
外部のデータベースの版までは見られません。

## 複数インスタンス

複数のインスタンスを同時に起動しても構いません。
`pnpm db:migrate` はデータベースのアドバイザリロックで適用を直列化します。
先に取った 1 つだけが適用し、他は待ってから適用済みの状態を読み直すため、
同じマイグレーションが二重に走ることはありません。
プロセスが途中で落ちた場合も、接続が切れた時点でロックは解放されます。

マイグレーション適用前は、ワーカーが送信待ちを取得できない旨をログへ記録し、
一定間隔で確認し直します。適用後は、プロセスを再起動しなくても送信処理を始めます。

## 公開する前に

次を必ず行ってください。

- IC カードを使う場合は `.env` の `CARD_FINGERPRINT_KEY` を `openssl rand -hex 32` の出力にする
- `.env` の `DB_PASSWORD` を変更する（`db`・`app`・`webhook-worker` がこの値を共有します）
- HTTPS で終端する（`NODE_ENV=production` のとき、セッション Cookie に `Secure` が付きます）

`DB_PASSWORD` は接続文字列（URL）へそのまま入るため、URL で意味を持つ文字
（`@` `:` `/` `?` `#` `[` `]` 空白）を含めないでください。
`openssl rand -hex 24` の出力のように、英数字だけで作れば安全です。

## ホストへの公開範囲

`docker compose` がホストへ公開するポートは、既定でループバックにだけ結び付きます。

| 設定 | 既定 | 変えるとき |
| --- | --- | --- |
| `DB_HOST_BIND` | `127.0.0.1` | 他のホストから PostgreSQL へ直接つなぐ場合 |
| `APP_HOST_BIND` | `127.0.0.1` | 前段のプロキシを介さず、直接公開する場合 |

`DB_HOST_BIND` を広げると、PostgreSQL が公開ネットワークに面します。
`DB_PASSWORD` を変更していない状態で広げないでください。

## 逆プロキシ

応答のヘッダーは製品の側で付けます。逆プロキシ側で同じヘッダーを重ねる場合の注意と、
`Origin` を検査する構成の設定は [security/http-hardening.md](security/http-hardening.md) にあります。
