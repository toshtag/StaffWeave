# 能力マトリクス

StaffWeave が扱う能力を 1 行ずつ並べ、それぞれがいまどの状態かを示します。
「動くもの」を読むための一覧は [features.md](../guide/features.md) です。
こちらは「作らないと決めたもの」と「いつ作るか」まで含めた、能力の側の正本です。

状態は 4 つだけです。

- `implemented` — いま動く。
- `partial` — 一部だけ動く。いま動く部分と、足りない部分の両方を備考に書く。
- `planned` — まだ無い。どのフェーズで作るかを備考に書く。
- `non-goal` — 作らないと決めた。理由を備考に書く。

`根拠` は、その状態を確かめるための指し先です。読む人が実装を辿れるように書きます。

- `op:` — API 契約（`packages/contracts/src/operations.ts`）の操作の名前
- `test:` — 振る舞いを固定しているテスト
- `ui:` — 画面
- `script:` — 脚本
- `migration:` — DB の構造

書き方を機械では検査しません。表の形を厳密に読む検査を置いても、
確かめられるのは「表が壊れていないか」までで、書いてあることが本当かは分かりません。
文書を直すたびに検査も直すことになり、割に合いませんでした。
能力の正しさは、実装とテストを見てレビューで判断します。

フェーズごとの順序と理由は [roadmap.md](../roadmap.md) にあります。

## 打刻

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 本人による打刻（出勤・退勤・休憩） | implemented | `op:recordAttendanceEvent` `op:getTodayAttendance` `test:packages/domain/src/attendance/events.test.ts` | 追記のみ・冪等受理・監査記録つき |
| スマートフォンからの打刻 | implemented | `ui:packages/web/src/pages/TodayAttendance.tsx` `test:packages/web/src/offline/punch-queue.test.ts` | オフライン待機と自動再送を含む |
| 署名付き端末イベントの受理 | implemented | `op:recordDeviceEvent` `test:packages/domain/src/device/protocol.test.ts` | 署名・連番・時計差を検証して受け取る。送る側はシミュレーター |
| 実運用できる共有打刻端末 | planned | - | 常駐する実機が無く、シミュレーターから送っている（P24） |
| カードイベントの受理と指紋の登録 | implemented | `op:recordCardEvent` `op:registerCard` | 生の識別子は送らず保存もしない |
| 実カードリーダーからの読み取り | planned | - | シミュレーターが識別子を手入力で受け取っている（P24） |
| PC セッション観測の受理と差異の提示 | implemented | `op:recordSessionObservations` `op:getDiscrepancyReport` `test:packages/domain/src/attendance/session-observations.test.ts` | 勤務時間は自動確定しない |
| OS からのセッション観測の自動取得 | planned | - | 送る側は常駐サービスが要る（P24） |
| 拠点のタイムゾーンによる業務日判定 | implemented | `test:packages/domain/src/attendance/business-date.test.ts` | 現地の暦日と時刻で決める。夏時間の切り替わる日もずれない |
| 日をまたぐ勤務を 1 日として扱う | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/domain/src/attendance/business-date.test.ts` | 業務日の開始時刻を基準に 1 日として扱う |
| 1 日に複数の勤務区間 | planned | - | 退勤したあとの再出勤を受け付けない（P17） |
| カードの 1 回のタップで休憩を始める | planned | - | 勤務中のタップは退勤に割り当てている（P24） |
| 打刻時の位置情報 | planned | - | 取得・同意・精度・保持期間・閲覧権限のいずれも無い（P24） |

## 勤務予定と勤務区分

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 勤務パターン（始業・終業・休憩の合計分数） | implemented | `op:createWorkPattern` `op:listWorkPatterns` `migration:0005_create_schedules_and_calculations.sql` | 所定時刻のひな形として持つ |
| 勤務予定の登録 | implemented | `op:upsertWorkSchedule` `op:listWorkSchedules` | 従業員と業務日ごとに持つ |
| 勤務周期による予定の生成 | implemented | `op:generateWorkSchedules` `op:createWorkCycle` `test:packages/domain/src/schedule/work-cycle.test.ts` | 曜日を前提にしない |
| 有効期間付きの制度切り替え | implemented | `op:assignWorkCycle` `op:endWorkCycleAssignment` `migration:0019_exclude_overlapping_work_cycles.sql` | 期間の重なりを DB で排他する |
| 版管理された勤務区分 | planned | - | 管理者名・表示名・種別・所定分数を持つ集約が無い（P18） |
| 複数の固定休憩 | planned | - | 休憩は合計分数だけを持つ（P18） |
| 自動休憩（労働時間の閾値で足す） | planned | - | 閾値・追加分数・追加位置のいずれも無い（P18） |
| みなし労働時間 | planned | - | 勤務区分側に持たせる（P18） |
| シフト属性と表示色 | planned | - | 周期生成はあるが、シフトとしての属性が無い（P18） |
| マスターの改定・無効化・コピー | planned | - | 勤務パターン・休暇種別・勤務周期は作成と一覧が中心（P18） |

## 勤務時間の計算

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 実労働・休憩・在社時間 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` | 分単位で数え、日跨ぎでも数え落とさない |
| 計算の決定性と根拠の保存 | implemented | `migration:0005_create_schedules_and_calculations.sql` `test:packages/domain/src/attendance/calculation.test.ts` | 入力の指紋・ルール版・区間・手順を結果と一緒に残す |
| 深夜帯の集計 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` | 既定は 22:00–5:00 |
| 丸め | implemented | `test:packages/domain/src/attendance/calculation.test.ts` | 単位と方法をワークスペースごとに保存できる |
| 計算ルールの変更 | partial | `migration:0005_create_schedules_and_calculations.sql` | 値はワークスペースごとに保存できる。変える経路が API にも画面にも無い（P18） |
| 所定内・所定外 | partial | `test:packages/domain/src/attendance/calculation.test.ts` | 所定の時間帯の内外は出せる。法定の区分を持たない（P18） |
| 休日労働 | partial | `test:packages/domain/src/attendance/calculation.test.ts` | 休日労働としてまとめて出せる。法定休日と法定外休日を区別しない（P18） |
| 所定休憩の実労働からの控除 | partial | `test:packages/domain/src/attendance/calculation.test.ts` | 所定の休憩は所定労働時間を減らす。実労働からは実際の休憩打刻だけを引く（P18） |
| 法定内時間外・法定時間外 | planned | - | 日・週・月の閾値を持たない（P18） |
| 深夜時間外・深夜休日 | planned | - | 深夜と時間外・休日を掛け合わせた区分が無い（P18） |
| 遅刻・早退・始業前・終業後 | planned | - | 所定時刻との差を集計しない（P18） |
| 週・月の集計 | planned | - | 日次の計算だけを持ち、期間の集計エンジンが無い（P18） |
| 認定時間（申請した残業上限の反映） | planned | - | 申請側に上限時刻が無い（P21） |

## 労働形態

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 一般勤務（固定・時短・シフト） | partial | `op:createWorkPattern` `op:upsertWorkSchedule` | 所定時刻と勤務周期で表せる。勤務区分としての設定を持たない（P18） |
| フレックスタイム制 | planned | - | 清算期間・総枠・コアタイム・不足・繰越のいずれも無い（P19） |
| 裁量労働制 | planned | - | みなし時間と実績を分けて持たない（P19） |
| 変形労働時間制 | planned | - | フレックスと裁量のあとに判断する（P19） |

## 休暇

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 休暇・欠勤の日としての記録と分数の集計 | implemented | `op:createLeaveType` `op:listLeaveTypes` `migration:0011_add_leave_minutes_to_calculations.sql` | 勤務予定の日種別として持ち、実労働とは別に数える |
| 休暇種別 | partial | `migration:0010_create_work_cycles_and_leave.sql` | code・名称・有給無給を持つ。取得単位も有効期限も持たない（P20） |
| 残数の台帳（付与・消化・失効・調整・取消） | planned | - | 残数そのものを持たない（P20） |
| 自動付与・一斉付与・CSV 取込 | planned | - | 付与の手段が無い（P20） |
| 半日・時間単位の取得 | planned | - | 取得の単位が日だけになる（P20） |
| 申請と残数の原子的な予約・消化・返却 | planned | - | 残数が無いため予約もできない（P20） |
| 休暇管理簿と失効予定の出力 | planned | - | 台帳のあとに作る（P23） |

## 申請と承認

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 日次勤怠の申請・承認・差し戻し・取消 | implemented | `op:submitDailyRequest` `op:approveDailyRequest` `op:returnDailyRequest` `op:cancelDailyRequest` `test:packages/domain/src/approval/daily-request.test.ts` | 遷移の履歴を追記で残す |
| 自己承認の禁止 | implemented | `test:packages/domain/src/identity/roles.test.ts` | 承認者と対象者が同じなら断る |
| 申請区分（休暇・残業・休日出勤・直行直帰・打刻修正など） | planned | - | 従業員と日付ごとに 1 件の日次申請しか無い（P21） |
| 区分ごとの入力項目と必須の設定 | planned | - | 申請区分のあとに作る（P21） |
| 1〜4 段階の承認と申請時点の経路の固定 | planned | - | 権限を持つ利用者が 1 度承認すると完了する（P21） |
| 代理承認・不在対応 | planned | - | 段階承認のあとに判断する（P21） |
| 承認結果の勤怠・休暇への反映 | planned | - | 承認は申請の状態だけを変え、勤怠へ反映しない（P21） |
| 利用者への通知 | planned | - | Webhook は外部システム向けで、利用者通知の代わりにはならない（P21） |

## 締めと監査

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 月次の締めと締め解除 | implemented | `op:closeMonth` `op:reopenMonth` `test:packages/domain/src/approval/monthly-closing.test.ts` | 承認済みの確認を伴う |
| 締めたあとの編集の制御 | implemented | `migration:0006_create_requests_and_closings.sql` `test:packages/domain/src/approval/monthly-closing.test.ts` | 締め済みの期間は黙って書き換えない |
| 打刻の修正・取消・追加 | implemented | `op:correctAttendance` `test:packages/domain/src/attendance/corrections.test.ts` `migration:0004_add_attendance_corrections.sql` | 理由必須、元の記録は残る |
| 過去日の訂正 | implemented | `op:correctAttendance` `test:packages/domain/src/attendance/occurred-at.test.ts` | 400 日前まで遡って直せる。締め済みの期間は断る |
| 監査記録の閲覧 | implemented | `op:listAuditLogs` | 誰がいつ何を変えたかを追える |
| 異常の検出と根拠つきの表示 | implemented | `op:listAnomalies` `test:packages/domain/src/audit/anomaly.test.ts` `ui:packages/web/src/pages/AnomalyPanel.tsx` | 確定後の変更・大量修正・時計差・連番欠落・重複打刻 |

## 端末

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 端末の登録・失効と受領記録 | implemented | `op:registerDevice` `op:enrollDevice` `op:revokeDevice` `op:listDeviceReceipts` | 登録トークンに有効期限がある |
| 端末シミュレーターによる打刻の確認 | implemented | `test:packages/agent/src/client.test.ts` | 実機なしで取り決めを確かめられる |
| IC カードの登録・失効 | implemented | `op:createCardRegistration` `op:revokeCardCredential` `op:listCardCredentials` | 指紋だけを保存する |
| 実機の常駐サービス（インストーラー・自動更新・診断） | planned | - | いまあるのは取り決めとシミュレーターだけ（P24） |

## 画面

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| ログインと当日の勤怠・打刻・訂正 | implemented | `ui:packages/web/src/pages/SignInPage.tsx` `ui:packages/web/src/pages/TodayAttendance.tsx` | 日本語と英語 |
| 承認待ちの一覧と承認 | implemented | `ui:packages/web/src/pages/PendingApprovals.tsx` |  |
| 差異と異常の表示 | implemented | `ui:packages/web/src/pages/DiscrepancyPanel.tsx` `ui:packages/web/src/pages/AnomalyPanel.tsx` | 根拠つきで出す |
| 組織の一覧表示 | implemented | `ui:packages/web/src/pages/HomePage.tsx` | 読み取りのみ。登録と編集は API だけ |
| API キーの管理 | implemented | `ui:packages/web/src/pages/ApiKeys.tsx` | 作成・一覧・失効 |
| 本人のセッション一覧とログアウト | implemented | `ui:packages/web/src/pages/ActiveSessions.tsx` | 端末ごと・一括 |
| 勤怠時刻を拠点の時間帯で表示・入力する | planned | - | 表示も `datetime-local` も閲覧者のブラウザの時間帯を使う（P17） |
| 上部のモジュール切替と左メニュー | planned | - | 画面は 1 つで、機能を縦に並べている（P22） |
| 組織・従業員・勤務区分・休暇・申請区分の設定画面 | planned | - | API では扱えるが、設定するための画面が無い（P22） |
| 日次・月次の一覧とレポート | planned | - | 締めの進み具合、未申請・未承認、長時間労働の警告を含む（P23） |
| WCAG 2.2 AA | planned | - | 自動検査も視覚回帰も無い（P22） |

## 外部連携と出力

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 日次勤怠の CSV 出力 | implemented | `op:exportAttendanceCsv` `test:packages/domain/src/integration/csv.test.ts` | 表計算で数式として動かない形で出す |
| 従業員の CSV 取込 | implemented | `op:importEmployeesCsv` | 取り込めなかった行を位置つきで返す |
| API キーとスコープ | implemented | `op:createApiKey` `op:revokeApiKey` `test:packages/domain/src/integration/api-key-usage.test.ts` | 生の鍵は作成時に 1 度だけ返す |
| Webhook の署名と送信先の制約 | implemented | `op:createWebhookEndpoint` `op:listWebhookDeliveries` `migration:0014_create_webhook_outbox.sql` | 送信待ちは業務処理と同じトランザクションで積む |
| connector SDK | implemented | `test:packages/connector/src/index.test.ts` | 外部連携を作るための足場 |
| 給与連携の CSV 出力 | partial | `op:exportPayrollCsv` | 月次の集計は出せる。計算側が法定の区分を持たないため項目が限られる（P23） |
| Webhook の自動再送とデッドレター | planned | - | 失敗は記録するが、到達は保証しない（P25） |

## 認証と利用者

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| メールアドレスとパスワードのログイン | implemented | `op:login` `op:logout` `test:packages/domain/src/identity/login-attempts.test.ts` | 試行回数の制限つき |
| 本人によるセッションの一覧と失効 | implemented | `op:listSessions` `op:revokeSession` `op:revokeOtherSessions` `test:packages/domain/src/identity/session.test.ts` |  |
| パスワードの変更 | implemented | `op:changePassword` `test:packages/domain/src/identity/credentials.test.ts` |  |
| ロールによる権限制御 | implemented | `test:packages/domain/src/identity/roles.test.ts` | ワークスペース管理者・組織管理者・従業員 |
| 契約・配属・閲覧範囲 | implemented | `op:createAssignmentContract` `op:createEmployeeAssignment` `op:grantUserScope` `test:packages/domain/src/organization/assignment.test.ts` | 期間付きで持つ |
| 日本語と英語の切り替え | implemented | `op:updatePreferences` `test:packages/domain/src/i18n/locale.test.ts` |  |
| 管理者による他の利用者のセッション失効 | planned | - | 退職・端末紛失の対応に要る（P25） |
| 招待・パスワード再設定・メールアドレス変更 | planned | - | 管理者が作り、初回のパスワードを渡す運用になる（P25） |
| MFA・SSO | planned | - | 企業向けの要件として別に判断する（P25） |

## 運用

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| バックアップと復元 | implemented | `script:scripts/backup.sh` `script:scripts/restore.sh` | 手順と脚本がある |
| SBOM の生成と検証 | implemented | `script:scripts/generate-sbom.sh` `script:scripts/verify-sbom.mjs` | 配布物の構成を出せる |
| マイグレーションの検証 | implemented | `test:packages/db/src/migrator.test.ts` `test:packages/api/test/integration/migration-concurrency.test.ts` | 二重適用・内容変更・DB 名の誤指定を止める |
| 定期的な復元の演習 | planned | - | 手順はあるが、実施の証跡を検証に含めていない（P25） |
| 構造化ログ・相関 ID・メトリクス・アラート | planned | - | 運用の可観測性として別に判断する（P25） |
| Row-Level Security | planned | - | アプリ側の認可が正本。採否を決める（P25） |
| データの保持・アーカイブ・削除の取り決め | planned | - | 個人データの扱いとして要る（P25） |
| 配布物の署名と出所の証明 | planned | - | 受け取った側が改ざんを確かめられない（P26） |
| 負荷試験・障害注入 | planned | - | 締め日の集中と同時操作を確かめていない（P26） |
| 給与計算そのもの | non-goal | - | 計算した勤務時間を出すところまでを範囲とし、賃金の計算は連携先に委ねる |
| 労働法令への適合の保証 | non-goal | - | 実装した計算の範囲は示すが、規程に合っているかは導入する側で確かめる |
| 公開デモ環境 | non-goal | - | 手元で `pnpm seed:demo` を使う。常時動く環境の運用は負担に見合わない |
| SaaS の運用（このリポジトリが配るもの） | non-goal | - | 配るのはセルフホスト用の一式だけで、運用する側にはならない。コードが SaaS として動けること自体は設計要件として持ち続ける（ワークスペース分離） |
| マイクロサービス・Kubernetes・Redis・Kafka | non-goal | - | 単一の PostgreSQL と Docker Compose で起動できることを優先する |
