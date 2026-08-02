# staffweave

セルフホスト可能な勤怠管理基盤（開発中）。

staffweave は、従業員の勤務実績を「観測された事実」と「人が確定させた記録」に分けて扱う勤怠管理システムです。
打刻・ICカード・PC セッションなどの記録は上書きされない観測イベントとして保存し、
そこから計算・申請・承認を経て確定値を作ります。

## 現在の状態

**P14（外部連携の初期実装）完了時点。公開判定は保留中です。**

実装後のレビューで、認可の適用漏れ・競合制御・秘密情報の扱いに未解決の問題が見つかりました。
`release-blocker` を付けた GitHub Issue として登録してあります。
これらを解消するまで、公開も実データの投入も行いません。

動作するもの:

- ワークスペース、組織、拠点、部門、従業員の登録と一覧
- メールアドレスとパスワードによるログイン、セッション、ログアウト
- ロールによる権限制御（ワークスペース管理者 / 組織管理者 / 従業員）
- 日本語と英語の切り替え
- 本人による出勤・退勤・休憩の打刻と当日の状態表示（追記のみ・二重送信防止・監査記録つき）
- 日付をまたぐ勤務の一日としての扱い
- 打刻の修正・取消・追加（理由必須、元の記録は残り、変更前後を追える）
- 勤務パターンと勤務予定の登録
- 実労働・休憩・所定内外・深夜帯・休日労働の決定的な計算（入力版・ルール版・根拠つき）
- 日次の申請・承認・差し戻し・取消と、その履歴
- 月次締めと締め解除、確定後の編集制御
- スマートフォン向けの打刻画面（オフライン待機・自動再送・冪等受理）
- 打刻端末の登録・失効と、署名付きイベントの受理（連番・時計差・受信記録つき）
- 端末シミュレーター（実機なしで取り決めを確認できる）
- IC カードの登録・失効とカードによる打刻（生の識別子は送らず保存もしない）
- PC セッションの観測記録と、打刻との食い違いの提示（自動確定はしない）
- 勤務周期による勤務予定の生成（週休 3 日・2 勤 2 休など、曜日を前提にしない）
- 休暇・欠勤の記録と集計、有効期間付きの制度切り替え
- 雇用元と受入組織の契約、配属、勤務先別の閲覧権限と外部承認者
- 確定後の変更・大量修正・端末時計差・連番欠落・重複打刻の検出と、根拠つきの表示・CSV 出力
- CSV の入出力、給与連携向けの汎用出力、Webhook、API キーとスコープ
- 外部連携を作るための connector SDK、バックアップと復元、デモ用データ

ロードマップの P0〜P14 は完了し、現在は P15（公開前セキュリティ・整合性是正）を進めています。
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

# 3. PostgreSQL を起動（ホスト側は既定で 127.0.0.1:5433 にだけ公開）
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

### 打刻端末の試用

実機を用意せずに、端末の登録から署名イベントの送信までを試せます。

```sh
# 1. 管理者として端末を登録し、一度きりの登録トークンを受け取る
#    （画面または API で /api/devices を呼び出す）

# 2. Agent が登録トークンと引き換えに公開鍵を登録する
pnpm agent enroll --url http://127.0.0.1:8787 --token <登録トークン>

# 3. 署名付きの打刻を送る
pnpm agent punch --employee E001 --type clock_in

# 4. 直前のイベントをそのまま再送する（記録は増えない）
pnpm agent replay

# 5. IC カードを登録し、カードで打刻する
#    （管理者が /api/card-credentials/registrations で登録トークンを発行しておく）
pnpm agent card-register --token <登録トークン> --card <カード識別子>
pnpm agent card-punch --card <カード識別子>

# 6. PC セッションの観測を送る
pnpm agent session-observe --employee E001 --type sign_in
```

IC カードの生の識別子は端末の中で一方向の指紋へ変換され、サーバーへは送られません。
指紋の計算に使う鍵は、`.env` の `CARD_FINGERPRINT_KEY` から Workspace ごとに導出し、
端末の登録時に渡します。共通の鍵そのものは端末へ渡りません。
この鍵はデータベースへ保存されないため、データベースの内容だけでは物理カードと結び付けられません。

```sh
openssl rand -hex 32   # CARD_FINGERPRINT_KEY へ設定する値を作る
```

`CARD_FINGERPRINT_KEY` が未設定なら、IC カードの経路は 404 で断ります。
32 文字未満の値や見本のままの値では API は起動しません。
鍵を変更すると導出後の鍵も変わり、登録済みのカードは登録し直しになります。
詳細は [docs/security/card-fingerprint-key.md](docs/security/card-fingerprint-key.md) を参照してください。

秘密鍵は Agent 側のファイルにのみ保存され、サーバーへは公開鍵しか渡りません。
資格情報のファイルは `.gitignore` に登録済みです。

### デモ用データ

説明のための架空のデータを入れて、ひととおりの画面を確認できます。

```sh
pnpm seed:demo            # デモワークスペースを作る
pnpm seed:demo --reset    # 作り直す
```

作成される利用者とパスワードは実行時に表示されます。
すべて架空の値です。公開された場所では使わないでください。

### 外部連携

```sh
# API キーを作る（生の鍵は作成時の応答にしか現れません）
curl -X POST http://127.0.0.1:8787/api/api-keys \
  -H 'content-type: application/json' -b cookie.txt \
  -d '{"name":"給与連携","scopes":["payroll:read"]}'

# API キーで月次の集計を取り出す
curl -H 'authorization: Bearer <生の鍵>' \
  'http://127.0.0.1:8787/api/exports/payroll.csv?period=2026-04-01'
```

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

Webhook は承認・差し戻し・締め・締め解除で送られます。
受け取り側の署名検証は `@staffweave/connector` の `verifyWebhook` を使ってください。
署名用の秘密は送信先の登録時にしか返りません。

署名は対称鍵の HMAC-SHA256 です。データベースに保存している
`webhook_endpoints.signing_key` は照合用のハッシュではなく、**そのまま正当な署名を作れる鍵**です。

- データベースを読める者は、任意の本文へ正当な署名を付けられます。
- データベースのバックアップ、ダンプ、スナップショットにも署名鍵が含まれます。
- データベースとバックアップは機密情報として扱い、読み取り権限を最小限にしてください。
- 詳細は [docs/security/webhook-signing.md](docs/security/webhook-signing.md) を参照してください。

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

#### 送信先の制限

既定では、公開ネットワークとして扱えるアドレスへしか送りません。
ループバック、私設ネットワーク、リンクローカル、クラウドのメタデータサービス、
マルチキャスト、予約済み・文書用のアドレスは拒否します。

IPv6 は、拒否一覧に無いことを公開の根拠にしません。まずグローバルユニキャストとして
割り当てられた範囲であることを確かめ、そのうえで文書用・試験用・移行用などの
特別用途を除きます。送信先の URL は 2048 文字以内です。

- 検査は送信先の登録時と、送信の直前の両方で行います。
  すでに登録済みの送信先も、送信のたびに検査し直します。
- ホスト名が複数のアドレスへ解決される場合は、すべてを検査します。
  一つでも許可されないアドレスがあれば、そのホストへは送りません。
- 検査したアドレスへ接続先を固定します。HTTP クライアントが名前を引き直すことはありません。
  HTTPS では、接続先を固定したうえで元のホスト名に対して証明書を検証します。
- リダイレクト（3xx）には追従しません。送信履歴には失敗として残ります。
- 応答本文は保存もログ出力もしません。64 KiB を超えた時点で接続を切ります。
  応答ヘッダーの上限は 16 KiB です。
- 名前解決した候補は 1 件へ絞りません。すべて検査済みなので、IPv4 と IPv6 の
  両方が返った場合は、接続できる方へつなぎます。接続時に名前を引き直すことはありません。
- 送信では、名前解決から応答の読み取りまでを `WEBHOOK_SEND_TIMEOUT_MS` の上限に含みます。
  登録時の検査には `WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS`（既定 3000 ミリ秒）を使います。
- 検査で拒否した送信は `failed` として記録します。自動再送はしません。

名前解決には DNS への問い合わせを使います。打ち切れる必要があるためで、
`hosts` ファイルにだけ書いた別名は解決できません。ローカルの送信先は、
DNS で引ける名前（コンテナのサービス名など）か IP リテラルで指定してください。

内部サービスへ送りたいセルフホスト構成では、`WEBHOOK_NETWORK_POLICY=allow-local` を
API とワーカーの両方へ設定します。ループバック、RFC 1918 の私設ネットワーク、
IPv6 のユニークローカルを追加で許可します。

**`allow-local` でも、常時拒否する宛先は許可されません。**
リンクローカル、マルチキャスト、未指定アドレスに加え、既知のメタデータエンドポイント
（`169.254.169.254`、`fd00:ec2::254`、`fd20:ce::254`）や、公開空間にありながら
基盤の内部通信へ割り当てられている仮想アドレス（`168.63.129.16`）を含みます。
IPv6 ユニークローカル（`fc00::/7`）は
通常の内部サービス宛として使えますが、その中にあるメタデータエンドポイントだけは拒否します。
「ユニークローカルなら何でも送れる」わけではありません。

送信先を検査していても、受け取り側の認証、署名検証、`eventId` による重複排除は引き続き必要です。

### バックアップと復元

```sh
docker compose --profile app stop app webhook-worker   # 復元の前に接続を止める
pnpm backup                                        # backups/ へ保存
pnpm restore backups/staffweave-<日時>.dump         # 復元（既存データは失われます）
```

復元は次の順で進みます。

1. 対象データベースへの接続が残っていれば中止します。
   稼働中の復元は進行中のトランザクションと衝突し、打刻の記録が失われうるためです。
2. 確認としてデータベース名の入力を求めます。`y` の一文字では実行しません。
3. 復元前の状態を `backups/before-restore-<日時>.dump` へ保存します。
4. `--single-transaction` で復元します。途中で失敗した場合は実行前の状態に戻ります。
   削除だけが済んだ状態にはなりません。

動作を確かめる場合は、検証用のデータベースを作り、
`STAFFWEAVE_DB_NAME` でそこを指してから、正常なダンプと壊したダンプの両方で実行してください。

バックアップには業務データがすべて含まれます。保管場所の扱いに注意してください。

バックアップには Webhook の署名鍵も含まれます。
バックアップを読める者は Webhook の署名を生成できるため、
暗号化とアクセス制限を行ってください。

`CARD_FINGERPRINT_KEY` はバックアップに含まれません。
復元後に IC カード機能を使うには、同じ鍵を環境変数へ設定する必要があります。
別の鍵で復元すると、登録済みのカードはどれも一致しなくなります。

### Docker だけで動かす

```sh
cp .env.example .env
docker compose --profile app up -d
docker compose exec app pnpm db:migrate
docker compose exec app pnpm bootstrap --email admin@example.com
```

`http://127.0.0.1:8787` で API と画面の両方が使えます。
`app` と同じイメージで `webhook-worker` も起動します。

複数のインスタンスを同時に起動しても構いません。
`pnpm db:migrate` はデータベースのアドバイザリロックで適用を直列化します。
先に取った 1 つだけが適用し、他は待ってから適用済みの状態を読み直すため、
同じマイグレーションが二重に走ることはありません。
プロセスが途中で落ちた場合も、接続が切れた時点でロックは解放されます。
マイグレーション適用前は、ワーカーが送信待ちを取得できない旨をログへ記録し、
一定間隔で確認し直します。適用後は、プロセスを再起動しなくても送信処理を始めます。

実行用のイメージには、動かすのに必要なものだけが入ります。
開発用の依存とテストは含まれません。プロセスは非 root（`node`）で動きます。

公開する場合は次を必ず行ってください。

- IC カードを使う場合は `.env` の `CARD_FINGERPRINT_KEY` を `openssl rand -hex 32` の出力にする
- `.env` の `DB_PASSWORD` を変更する（`db`・`app`・`webhook-worker` がこの値を共有します）
- HTTPS で終端する（`NODE_ENV=production` のとき、セッション Cookie に `Secure` が付きます）

`DB_PASSWORD` は接続文字列（URL）へそのまま入るため、URL で意味を持つ文字
（`@` `:` `/` `?` `#` `[` `]` 空白）を含めないでください。
`openssl rand -hex 24` の出力のように、英数字だけで作れば安全です。

#### ホストへの公開範囲

`docker compose` がホストへ公開するポートは、既定でループバックにだけ結び付きます。

| 設定 | 既定 | 変えるとき |
| --- | --- | --- |
| `DB_HOST_BIND` | `127.0.0.1` | 他のホストから PostgreSQL へ直接つなぐ場合 |
| `APP_HOST_BIND` | `127.0.0.1` | 前段のプロキシを介さず、直接公開する場合 |

`DB_HOST_BIND` を広げると、PostgreSQL が公開ネットワークに面します。
`DB_PASSWORD` を変更していない状態で広げないでください。

#### 応答のヘッダー

API と画面のどちらの応答にも、次のヘッダーを製品の側で付けます。逆プロキシ側の設定は要りません。

| ヘッダー | 値 |
| --- | --- |
| `Content-Security-Policy` | 自分自身からの取得だけを許し、埋め込みを拒む |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` / `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control`（`/api` の応答） | `no-store` |
| `Strict-Transport-Security` | `NODE_ENV=production` のときだけ送る |

#### ログイン試行の制限

ログインの失敗を数え、続いたら受け付けを断ります。断っているあいだは
パスワードの照合そのものを行いません。誤ったパスワードを送るだけで
計算資源を使わせられる状態にしないためです。

| 設定 | 既定 | 数える単位 |
| --- | --- | --- |
| `LOGIN_MAX_FAILURES_PER_ACCOUNT` | 5 | ワークスペースと利用者の組 |
| `LOGIN_MAX_FAILURES_PER_SOURCE` | 50 | 送信元アドレス |
| `LOGIN_FAILURE_WINDOW_MS` | 15 分 | 数え直すまでの時間 |
| `LOGIN_BLOCK_MS` | 15 分 | 断る時間 |

- 断られたことは応答から区別できません。登録の有無を漏らさないためです。
  断ったことはログ（`auth.login_blocked`）に残ります
- 入れたら、その利用者の失敗の記録は消えます。送信元の記録は残ります
- 送信元は接続元のアドレスから決めます。前段の逆プロキシが `X-Forwarded-For` を
  必ず書き換える構成では `TRUST_PROXY_FOR_CLIENT_ADDRESS=true` にしてください。
  直接受ける構成で有効にすると、送信元を自由に名乗れて数える意味がなくなります
- 送信元が分からない場合は、その要求を送信元では数えません（利用者ごとの制限は効きます）

#### 送信元の検査

セッションは Cookie で運ぶため、ブラウザは別の頁からの要求にも自動で付けます。
`SameSite=Lax` は別サイトからの送信を止めますが、同じ登録ドメインの別サブドメイン
（`wiki.example.com` と `staffweave.example.com` など）は「同一サイト」として扱われ、止まりません。

そこで、Cookie を送っている状態変更（`GET` / `HEAD` / `OPTIONS` 以外）では `Origin` を検査します。

- 既定では、要求が届いた宛先（`Host`）と同じホストだけを許します
- 逆プロキシが `Host` を書き換える構成では、`ALLOWED_ORIGINS` へ実際のオリジンを並べます
- 端末の署名や API キーで来る要求は対象外です（ブラウザの資格情報を使わないため）
- `Origin` を持たない要求は通します。ブラウザは状態を変える要求へ必ず付けるため、
  この検査はブラウザ経由の攻撃に対して効きます。値を偽れる相手（ブラウザ以外）には効きません

#### 要求本文の上限

本文の大きさには上限があります。超えた要求は、本文を読み切らずに 413 で断ります。

| 設定 | 既定 | 対象 |
| --- | --- | --- |
| `MAX_REQUEST_BODY_BYTES` | 256 KiB | 打刻・認証・端末からの送信など、ふつうの要求 |
| `MAX_BULK_REQUEST_BODY_BYTES` | 8 MiB | 従業員の CSV 取り込み（`POST /api/imports/employees`） |

逆プロキシ側にも上限がある場合は、小さいほうが先に効きます。
大きな CSV を取り込む場合は、両方の値を確認してください。

#### 応答のヘッダーと逆プロキシ

逆プロキシで同じヘッダーを付ける場合は、値を二重に送らないようにしてください。
`Strict-Transport-Security` は HTTPS で終端している構成でだけ送ります。
HTTP で動かす構成へ送ると、その後 HTTPS へ移すまで画面を開けなくなります。

画面へ外部の資材（CDN のフォント、外部の画像、別ホストの API）を足す場合は、
`packages/api/src/shared/security/headers.ts` の取得先を広げる必要があります。

### 検証

```sh
pnpm verify            # 下の 7 つをこの順で実行する（DB 必要）
pnpm lint              # 書式と静的検査
pnpm typecheck         # 型検査
pnpm test              # 単体 + 統合（DB 必要）
pnpm test:e2e          # ブラウザによる E2E（DB 必要）
pnpm db:verify         # マイグレーションの適用漏れと内容の変更を検査
pnpm check:policy      # リポジトリの決めごと（名称・秘密情報・依存方向・マイグレーション）を検査
pnpm check:audit       # 依存の既知脆弱性（moderate 以上があれば失敗）

pnpm test:unit         # 単体テストのみ（DB 不要）
pnpm test:integration  # 統合テストのみ（DB 必要）
```

`pnpm verify` は CI が実行する検証と同じ内容です。
手元で通れば CI でも通る状態にするため、片方だけに項目を足しません。
コンテナのビルドだけは CI で行います（`docker build -f docker/api.Dockerfile`）。

`pnpm check:audit` はレジストリへ問い合わせるため、ネットワークが要ります。
すぐに直せない勧告は `scripts/audit-exceptions.txt` へ、勧告 ID・期限・理由を書いて見送れます。
期限を過ぎた見送りは、勧告が残っているかどうかに関わらず失敗します。

統合テストは `TEST_DATABASE_URL` のデータベースを使い、実行のたびにデータを消去します。
開発用データベースを誤って指さないよう、名前が `_test` で終わることを実行時に検査します。

E2E はさらに別の `staffweave_e2e` を使い、専用のポート（API 8788 / Web 5174）でサーバーを起動します。
初回は `pnpm exec playwright install chromium` でブラウザを取得してください。

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
| [docs/roadmap.md](docs/roadmap.md) | P0〜P22 のロードマップ |
| [docs/performance.md](docs/performance.md) | 問い合わせ回数と索引の決めごと |
| [docs/security/webhook-target-policy.md](docs/security/webhook-target-policy.md) | Webhook 送信先のネットワーク方針 |
| [docs/security/webhook-signing.md](docs/security/webhook-signing.md) | Webhook 署名鍵の保存と検証手順 |
| [docs/security/card-fingerprint-key.md](docs/security/card-fingerprint-key.md) | IC カード指紋鍵の設定と Workspace ごとの分離 |
| [docs/security/csv-output.md](docs/security/csv-output.md) | CSV 出力の無害化と、取り込み側から見える差 |

## ライセンス

MIT License. [LICENSE](LICENSE) を参照してください。
