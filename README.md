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
指紋の計算には `.env` の `CARD_FINGERPRINT_KEY` を使います。この鍵はデータベースへ保存されないため、
データベースの内容だけでは物理カードと結び付けられません。
鍵を変更すると既存のカード登録は使えなくなります。

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

### バックアップと復元

```sh
pnpm backup                                        # backups/ へ保存
pnpm restore backups/staffweave-<日時>.dump         # 復元（既存データは失われます）
```

バックアップには業務データがすべて含まれます。保管場所の扱いに注意してください。
`CARD_FINGERPRINT_KEY` はバックアップに含まれません。
復元後に IC カード機能を使うには、同じ鍵を環境変数へ設定する必要があります。

### Docker だけで動かす

```sh
cp .env.example .env
docker compose --profile app up -d
docker compose exec app pnpm db:migrate
docker compose exec app pnpm bootstrap --email admin@example.com
```

`http://127.0.0.1:8787` で API と画面の両方が使えます。
公開する場合は次を必ず行ってください。

- `.env` の `CARD_FINGERPRINT_KEY` を十分に長い秘密の値へ変更する
- PostgreSQL のパスワードを変更する
- HTTPS で終端する（`NODE_ENV=production` のとき、セッション Cookie に `Secure` が付きます）

### 検証

```sh
pnpm verify            # lint + typecheck + 全テスト + E2E
pnpm test:unit         # 単体テストのみ（DB 不要）
pnpm test:integration  # 統合テストのみ（DB 必要）
pnpm test:e2e          # ブラウザによる E2E（DB 必要）
pnpm db:verify         # マイグレーションの適用漏れと内容の変更を検査
pnpm check:policy      # リポジトリの決めごと（名称・秘密情報・依存方向）を検査
```

これらは GitHub Actions でも同じコマンドで実行されます。
CI でしか通らない状態を作らないため、検証の内容はローカルと揃えています。

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

## ライセンス

MIT License. [LICENSE](LICENSE) を参照してください。
