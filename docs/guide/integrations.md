# 外部連携

API キー、CSV の入出力、Webhook の使い方をまとめます。

細かい仕様は別の文書にあります。CSV の無害化は
[csv-output.md](../security/csv-output.md)、Webhook の署名鍵は
[webhook-signing.md](../security/webhook-signing.md)、送信先の制限は
[webhook-target-policy.md](../security/webhook-target-policy.md) を見てください。

## API キー

利用者アカウントを管理できる権限（`user.manage`）があれば、画面の「API キー」から
作成・一覧・失効ができます。同じことを API でも行えます。

- 生の鍵は作成した直後にだけ表示します。控えるまで画面は自分で閉じてください。
  一覧にも、読み直した後にも出てきません。
- 一覧に出るのは見分けるための先頭 8 文字だけです。
- 失効させた鍵も一覧に残します。消すと、連携が止まった理由が「鍵を失効させたから」
  なのか「そもそも作っていないのか」を後から辿れません。

```sh
# API キーを作る（生の鍵は作成時の応答にしか現れません）
curl -X POST http://127.0.0.1:8787/api/api-keys \
  -H 'content-type: application/json' -b cookie.txt \
  -d '{"name":"給与連携","scopes":["payroll:read"]}'

# API キーで月次の集計を取り出す
curl -H 'authorization: Bearer <生の鍵>' \
  'http://127.0.0.1:8787/api/exports/payroll.csv?period=2026-04-01'
```

API キーはすべての要求に付きます。`@staffweave/connector` の `createConnector` は、
ループバック以外の接続先が `https` でなければ、要求を出す前に断ります。
リダイレクトも追従しません。転送先は検査できないため、3xx はその場で失敗にします。
`curl` などで直接呼び出す場合も、公開ネットワーク越しでは `https` を使ってください。

API キーの「最後に使った時刻」は、要求のたびには書き直しません。
`API_KEY_USAGE_INTERVAL_MS`（既定 60000 ミリ秒）より新しい記録があれば、そのままにします。
この値は使われなくなったキーを見つけるためのもので、この間隔だけ古く見えます。

## CSV の入出力

出力できるもの:

| 出力 | 内容 |
| --- | --- |
| `GET /api/exports/attendance.csv?from&to` | 日次の勤怠と集計 |
| `GET /api/exports/payroll.csv?period` | 月次の集計（給与連携向けの汎用列） |
| `GET /api/audit/anomalies?from&to&format=csv` | 確認が必要な記録 |

取り込めるもの:

| 取り込み | 見出し |
| --- | --- |
| `POST /api/imports/employees` | `organization_code`, `employee_number`, `display_name`, `hired_on`（任意） |

大きな CSV を取り込む場合は、要求本文の上限を確認してください
（[security/http-hardening.md](../security/http-hardening.md)）。

## Webhook

Webhook は承認・差し戻し・締め・締め解除で送られます。
受け取り側の署名検証は `@staffweave/connector` の `verifyWebhook` を使ってください。
署名用の秘密は送信先の登録時にしか返りません。

署名は対称鍵の HMAC-SHA256 です。データベースに保存している値は照合用のハッシュではなく、
**そのまま正当な署名を作れる鍵**です。データベースとバックアップを機密情報として扱ってください
（[security/webhook-signing.md](../security/webhook-signing.md)）。

### 送信ワーカー

送信は API サーバーではなく、専用のワーカーが行います。

```sh
pnpm webhook:worker
```

- API は送信待ちを業務データと同じトランザクションで記録するだけです。
  **ワーカーを動かさない限り Webhook は届きません。**
- ワーカーが止まっている間も送信待ちはデータベースに残り、再開後に処理されます。
- ワーカーが送信した後、完了を記録する前に停止した場合は、同じ `eventId` の通知が
  もう一度送られることがあります。受け取り側は `eventId` で重複を取り除いてください。
- HTTP エラー、通信失敗、タイムアウトは送信履歴へ記録しますが、現時点では自動再送しません。
  **したがって通知の到達は保証しません。** 再送とデッドレター管理は今後の課題です。

### 送信先の制限

送信先は利用者が登録します。制限が無ければ、StaffWeave 自身が内部ネットワークへ
HTTP 要求を出す道具になります。そこで、送信先のアドレスを登録時と送信の直前に検査します。

起動時に決めるのは `WEBHOOK_NETWORK_POLICY` だけです。既定の `public-only` は
公開ネットワークとして扱えるアドレスだけを許し、`allow-local` は私設ネットワークを追加で許します。
この値は API とワーカーの**両方**へ設定します。片方だけ緩めた状態は作れません。

許す宛先の範囲、`http` を認める条件、検査の手順、応答と上限時間は
[webhook-target-policy.md](../security/webhook-target-policy.md) にあります。

送信先を検査していても、受け取り側の認証、署名検証、`eventId` による重複排除は引き続き必要です。

## 休暇の自動付与

自動付与は API サーバーではなく、日次の command が動かします。

```sh
pnpm leave:grants
```

- 休暇種別ごとに有効にし、始める日を決めます。基準を置いただけでは動きません。
- 動かさない限り、自動付与は 1 分も付与しません。cron や systemd timer から
  1 日 1 回呼んでください。
- 止まっていた期間は、次に動いたときに日ごとに追いつきます。
  同じ日を二度付与しないことは実行の記録が担保するため、
  1 日に何度呼んでも結果は変わりません。
- 日の境界はワークスペースの時間帯で決めます。動かす機械の時計では決めません。
- 実行・件数・積まなかった理由は監査へ残ります。
- 動かす前に、次の対象の日と人数を設定の画面から確かめられます。
