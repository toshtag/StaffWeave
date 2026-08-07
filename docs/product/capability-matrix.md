# 能力マトリクス

StaffWeave が扱う能力を 1 行ずつ並べ、それぞれがいまどの状態かを示します。
「動くもの」を読むための一覧は [features.md](../guide/features.md) です。
こちらは「作らないと決めたもの」と「いつ作るか」まで含めた、能力の側の正本です。

状態は 4 つだけです。

- `implemented` — いま動く。API の存在ではなく、利用者が使う経路から計算と
  保存まで通る証拠がある。
- `partial` — 一部だけ動く。いま動く部分と、足りない部分の両方を備考に書く。
- `planned` — まだ無い。どのフェーズで作るかを備考に書く。
- `non-goal` — 作らないと決めた。理由を備考に書く。

`根拠` は、その状態を確かめるための指し先です。読む人が実装を辿れるように書きます。
指し先が実在することは `test/capability-matrix.test.ts` が機械で確かめます。
指し先が消えても文書は同じ顔のまま残るため、そこだけは人に頼りません。

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
| 本人による打刻（出勤・退勤・休憩） | implemented | `op:recordAttendanceEvent` `op:getTodayAttendance` `test:packages/domain/src/attendance/events.test.ts` `test:packages/api/test/integration/attendance.test.ts` `test:e2e/golden-path.spec.ts` | 追記のみ・冪等受理・監査記録つき |
| スマートフォンからの打刻 | implemented | `ui:packages/web/src/pages/TodayAttendance.tsx` `test:packages/web/src/offline/punch-queue.test.ts` | オフライン待機と自動再送を含む |
| 署名付き端末イベントの受理 | implemented | `op:recordDeviceEvent` `test:packages/domain/src/device/protocol.test.ts` `test:packages/api/test/integration/device.test.ts` | 署名・連番・時計差を検証して受け取る。送る側はシミュレーター |
| 実運用できる共有打刻端末 | partial | `test:packages/api/test/integration/card-station.test.ts` `test:packages/api/test/integration/agent-package.test.ts` `docs:operations/device-agent-service.md` | 読み取りと送信を 1 つの常駐（`station`）で持ち、回線断をまたいで冪等に送る。**実機での常駐は未確認** |
| カードイベントの受理と指紋の登録 | implemented | `op:recordCardEvent` `op:registerCard` `test:packages/api/test/integration/card.test.ts` | 生の識別子は送らず保存もしない |
| 実カードリーダーからの読み取り | partial | `test:packages/agent/src/card/pcsc.test.ts` `docs:operations/device-agent-service.md` | PC/SC の経路（APDU・状態語・連続タップ・開き直し）はある。装置を叩く部品は端末側で用意する。**実機の読み取り装置では未確認** |
| PC セッション観測の受理と差異の提示 | implemented | `op:recordSessionObservations` `op:getDiscrepancyReport` `test:packages/domain/src/attendance/session-observations.test.ts` `test:packages/api/test/integration/session-observations.test.ts` | 勤務時間は自動確定しない |
| OS からのセッション観測の自動取得 | planned | - | 送る側は常駐サービスが要る（P24） |
| 拠点のタイムゾーンによる業務日判定 | implemented | `test:packages/domain/src/attendance/business-date.test.ts` `test:packages/api/test/integration/attendance.test.ts` | 現地の暦日と時刻で決める。夏時間の切り替わる日もずれない |
| 日をまたぐ勤務を 1 日として扱う | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/domain/src/attendance/business-date.test.ts` `test:packages/api/test/integration/attendance.test.ts` | 業務日の開始時刻を基準に 1 日として扱う |
| 1 日に複数の勤務区間 | implemented | `test:packages/domain/src/attendance/events.test.ts` `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/monthly-reporting.test.ts` | 退勤したあと再出勤できる。区間の間は勤務時間に数えない |
| カードの 1 回のタップで休憩を始める | planned | - | 勤務中のタップは退勤、退勤済みのタップは再出勤に割り当てている（P24） |
| 打刻時の位置情報 | implemented | `op:recordAttendanceEvent` `op:listAttendanceLocations` `op:updateOrganization` `ui:packages/web/src/admin/sections/OrganizationSettings.tsx` `test:packages/api/test/integration/attendance-location.test.ts` `migration:0037_create_attendance_locations.sql` | 組織ごとの opt-in。設定の画面から切り替えられる。既定は取らない。取れなくても打刻は残る。読めるのは本人と閲覧範囲の相手だけ |

> `implemented` は、API の存在ではなく、利用者が使う経路から計算と保存まで
> 通る証拠があるものだけに付けます。証拠は縦に通す検査（設定 → 打刻 →
> 保存された計算 → 月次 → 給与の出力）を指します。
> 画面から到達できない能力は `partial` にし、扱う Issue を備考へ書きます。

## 勤務予定と勤務区分

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 勤務パターン（始業・終業・休憩の合計分数） | implemented | `op:createWorkPattern` `op:listWorkPatterns` `ui:packages/web/src/admin/sections/WorkPatternSettings.tsx` `e2e:e2e/work-settings-console.spec.ts` `migration:0005_create_schedules_and_calculations.sql` | 所定時刻のひな形として持つ。設定の画面から作れる |
| 勤務予定の登録 | implemented | `op:upsertWorkSchedule` `op:listWorkSchedules` `ui:packages/web/src/admin/sections/WorkScheduleSettings.tsx` `test:packages/api/test/integration/work-category-calculation.test.ts` `e2e:e2e/work-settings-console.spec.ts` | 従業員と業務日ごとに持つ。勤務区分を割り当てられ、その設定が計算まで効く。設定の画面から作れる |
| 勤務周期による予定の生成 | implemented | `op:generateWorkSchedules` `op:createWorkCycle` `ui:packages/web/src/admin/sections/WorkCycleSettings.tsx` `test:packages/domain/src/schedule/work-cycle.test.ts` `e2e:e2e/work-settings-console.spec.ts` | 曜日を前提にしない。周期の作成・割当・生成を設定の画面から行える |
| 有効期間付きの制度切り替え | implemented | `op:assignWorkCycle` `op:endWorkCycleAssignment` `migration:0019_exclude_overlapping_work_cycles.sql` `test:packages/api/test/integration/work-cycle.test.ts` `ui:packages/web/src/admin/sections/WorkCycleSettings.tsx` | 期間の重なりを DB で排他する |
| 版管理された勤務区分 | implemented | `op:createWorkCategory` `op:listWorkCategories` `migration:0026_create_work_categories_and_rule_versions.sql` `test:packages/api/test/integration/work-category.test.ts` `ui:packages/web/src/admin/sections/WorkCategorySettings.tsx` `test:e2e/work-settings-console.spec.ts` | 同じ code で期間を分けて改定する。期間の重なりを DB で排他する |
| 複数の固定休憩 | implemented | `test:packages/domain/src/attendance/breaks.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` `migration:0026_create_work_categories_and_rule_versions.sql` | 実績と重なる分は二度引かない。勤務予定へ割り当てた勤務区分から効く |
| 自動休憩（労働時間の閾値で足す） | implemented | `test:packages/domain/src/attendance/breaks.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 閾値と追加分数を持つ。段階が複数でも足し合わせない |
| みなし労働時間 | implemented | `op:createWorkCategory` `op:assignLaborSystem` `test:packages/api/test/integration/work-category-calculation.test.ts` `test:packages/api/test/integration/labor-system-calculation.test.ts` | 勤務区分と労働形態の両方から日次の計算へ効く。裁量の割当がある日は労働形態を正本にする。実績とは別の値として残す |
| シフト属性と表示色 | implemented | `op:createWorkCategory` `ui:packages/web/src/admin/sections/WorkCategorySettings.tsx` `docs:product/work-category-fields.md` | 勤務区分が持ち、設定の画面から入れられる。計算にも集計にも入れない |
| マスターの改定・無効化・コピー | partial | `op:createWorkCategory` `op:updateLeaveType` `op:updateRequestType` | 勤務区分は版を重ねて改定でき、休暇種別と申請種別は無効化できる。勤務周期は作成と一覧のまま（作り直しで置き換える） |

## 勤務時間の計算

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 実労働・休憩・在社時間 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 分単位で数え、日跨ぎでも数え落とさない |
| 計算の決定性と根拠の保存 | implemented | `migration:0005_create_schedules_and_calculations.sql` `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/monthly-reporting.test.ts` | 入力の指紋・ルール版・区間・手順を結果と一緒に残す |
| 深夜帯の集計 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 既定は 22:00–5:00 |
| 丸め | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/calculation-rule-effects.test.ts` | 単位と方法をワークスペースごとに保存できる |
| 計算ルールの変更 | implemented | `op:createCalculationRuleVersion` `op:listCalculationRuleVersions` `test:packages/api/test/integration/calculation-rule-effects.test.ts` `ui:packages/web/src/admin/sections/CalculationRuleSettings.tsx` | 適用開始日つきの版を作る。過去の集計は当時の版のまま |
| 所定内・所定外 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 所定の時間帯の内外を出す |
| 休日労働 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 法定休日と法定外休日を分けて出す |
| 所定休憩の実労働からの控除 | implemented | `test:packages/domain/src/attendance/breaks.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 固定休憩は打刻が無くても引く。重なりは二度引かない |
| 法定内時間外・法定時間外 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/monthly-reporting.test.ts` | 1 日の閾値は事業者が設定する。未設定なら計算せず未設定として示す |
| 深夜時間外・深夜休日 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/work-category-calculation.test.ts` | 深夜帯は勤務区分で上書きでき、上書きが日次と月次と給与の出力まで効く |
| 遅刻・早退・始業前・終業後 | implemented | `test:packages/domain/src/attendance/calculation.test.ts` `test:packages/api/test/integration/calculation-rule-effects.test.ts` | 所定の時間帯との差から出す |
| 週・月の集計 | implemented | `op:listMonthlySummaries` `op:listPeriodSummaries` `test:packages/domain/src/attendance/period.test.ts` `test:packages/api/test/integration/period-summaries.test.ts` | 週の開始曜日は計算規則の版が決め、版が変わる日で週を区切り直す。返す期間の全日次を読むため、要求より広い清算期間でも合計が欠けない。割当で切り詰めた期間は印を付け、総枠と比べない |
| 認定時間（申請した残業上限の反映） | implemented | `op:decideEmployeeRequest` `test:packages/domain/src/attendance/approved-adjustments.test.ts` `test:packages/api/test/integration/request-attendance-effect.test.ts` | 承認しきった上限時刻までを認定し、超えた分を分けて出す。所定終業が未設定なら 0 ではなく未設定 |

## 労働形態

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 一般勤務（固定・時短・シフト） | implemented | `op:createWorkCategory` `op:assignLaborSystem` `test:packages/api/test/integration/labor-system-calculation.test.ts` `test:e2e/work-settings-console.spec.ts` | 勤務区分と労働形態の割当で表す |
| フレックスタイム制 | implemented | `op:assignLaborSystem` `op:listPeriodSummaries` `migration:0027_create_labor_system_assignments.sql` `test:packages/api/test/integration/period-summaries.test.ts` `test:packages/api/test/integration/labor-system-calculation.test.ts` `e2e:e2e/admin-console.spec.ts` `ui:packages/web/src/admin/sections/LaborSystemSettings.tsx` | 清算期間・総枠・決め方・コアタイム・フレキシブルタイムを設定の画面から入れられる。清算期間の集計と総枠との差を出す |
| 裁量労働制 | implemented | `op:assignLaborSystem` `test:packages/api/test/integration/labor-system-calculation.test.ts` `e2e:e2e/admin-console.spec.ts` | みなし分数を割当が持ち、日次の計算へ効く。実績は置き換えず、別の値として残す |
| 変形労働時間制 | implemented | `op:assignLaborSystem` `op:listPeriodSummaries` `test:packages/api/test/integration/period-summaries.test.ts` `test:packages/api/test/integration/labor-system-calculation.test.ts` `e2e:e2e/admin-console.spec.ts` | 対象期間と総枠を設定の画面から入れられる。対象期間の集計と総枠との差を出す |

## 休暇

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 休暇・欠勤の日としての記録と分数の集計 | implemented | `op:createLeaveType` `op:listLeaveTypes` `migration:0011_add_leave_minutes_to_calculations.sql` `test:packages/api/test/integration/request-attendance-effect.test.ts` | 勤務予定の日種別として持ち、実労働とは別に数える |
| 休暇種別 | implemented | `op:listLeaveTypeSettings` `op:updateLeaveType` `migration:0029_create_leave_ledger.sql` `test:packages/api/test/integration/leave-ledger.test.ts` `ui:packages/web/src/admin/sections/LeaveTypeSettings.tsx` | code・名称・有給無給に加え、取得の単位・1 日ぶんの分数・失効までの月数を持つ。既定値は置かない |
| 残数の台帳（付与・消化・失効・調整・取消） | implemented | `op:grantLeave` `op:adjustLeave` `op:reverseLeaveEntry` `op:listLeaveLedger` `test:packages/domain/src/leave/ledger.test.ts` `test:packages/api/test/integration/leave-ledger.test.ts` | 追記のみ。残数は保存せず、任意の時点の値を台帳から組み立てる |
| 残数の再構築と失効の反映 | implemented | `op:listLeaveBalances` `test:packages/domain/src/leave/ledger.test.ts` `test:packages/api/test/integration/leave-ledger.test.ts` | 期限の近い付与から先に消化する。期限を過ぎた分は残数から外れる |
| 自動付与・一斉付与・CSV 取込 | implemented | `op:runLeaveGrants` `op:previewLeaveGrants` `op:grantLeaveInBulk` `op:importLeaveGrantsCsv` `op:createLeaveGrantRule` `test:packages/domain/src/leave/grant.test.ts` `test:packages/api/test/integration/leave-grants.test.ts` `test:packages/api/test/integration/leave-grant-isolation.test.ts` `migration:0040_create_leave_grant_runs.sql` | 自動付与は日次の command（`pnpm leave:grants`）が動かす。設定の画面からの実行は、そのワークスペースだけを処理する。止まっていた期間は次の実行で追いつき、同時に走らせても同じ日を二度付与しない。手で押す一斉付与は別に残す。勤続の段から分数が決まり、段が無ければ 1 分も付与しない |
| 半日・時間単位の取得 | partial | `op:updateLeaveType` `test:packages/domain/src/leave/ledger.test.ts` | 休暇種別ごとに単位を決める。**台帳と残数までは通るが、設定から取得までを縦に通した証拠が無い** |
| 申請と残数の原子的な予約・消化・返却 | implemented | `op:decideEmployeeRequest` `migration:0029_create_leave_ledger.sql` `test:packages/api/test/integration/employee-request.test.ts` | 承認しきった時点で同じトランザクションで消化する。残数不足は承認ごと断る。二重反映は一意制約が止める |
| 休暇管理簿と失効予定の出力 | implemented | `op:listLeaveRegister` `op:listLeaveExpirations` `ui:packages/web/src/admin/sections/LeaveRegisterSettings.tsx` | 期首・付与・消化・失効・期末を台帳から組み立てる。画面から CSV で持ち出せる |

## 申請と承認

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 日次勤怠の申請・承認・差し戻し・取消 | implemented | `op:submitDailyRequest` `op:approveDailyRequest` `op:returnDailyRequest` `op:cancelDailyRequest` `test:packages/domain/src/approval/daily-request.test.ts` `test:packages/api/test/integration/approval.test.ts` `test:e2e/golden-path.spec.ts` | 遷移の履歴を追記で残す |
| 自己承認の禁止 | implemented | `test:packages/domain/src/identity/roles.test.ts` `test:packages/api/test/integration/approval.test.ts` | 承認者と対象者が同じなら断る |
| 申請区分（休暇・残業・休日出勤・打刻修正など） | implemented | `op:createRequestType` `op:listRequestTypes` `op:submitEmployeeRequest` `ui:packages/web/src/pages/RequestCenter.tsx` `test:packages/api/test/integration/employee-request.test.ts` `e2e:e2e/request-center.spec.ts` | 組織が定義する。従業員と日付ごとに 1 件という制限は無い。従業員は申請の画面から出せる |
| 区分ごとの入力項目と必須の設定 | partial | `op:createRequestType` `op:updateRequestType` `ui:packages/web/src/pages/RequestCenter.tsx` `e2e:e2e/request-center.spec.ts` | 理由・休暇種別・時間帯・残業の上限時刻の要否を区分ごとに決め、申請の画面が求めるものだけを出す。添付は未実装 |
| 1〜4 段階の承認と申請時点の経路の固定 | implemented | `op:decideEmployeeRequest` `op:replaceApprovalRoute` `test:packages/domain/src/approval/approval-route.test.ts` `test:packages/api/test/integration/employee-request.test.ts` `migration:0041_create_approval_routes.sql` | 段ごとに承認者または承認方針を決め、提出した時点の経路を写す。決まっていない段があれば提出を断る。現在の段の対象外の利用者による決裁も断る |
| 決裁の再送で段が進まないこと | implemented | `migration:0030_create_request_types_and_approvals.sql` `test:packages/api/test/integration/employee-request.test.ts` | 何段目・何回目の提出かを添えさせ、同じ組み合わせの二度目は一意制約が断る |
| 代理承認・不在対応 | partial | `op:createApprovalDelegation` `op:decideEmployeeRequest` `test:packages/domain/src/approval/approval-route.test.ts` `test:packages/api/test/integration/employee-request.test.ts` | 委任のある相手だけが代理で決裁でき、本来の承認者が監査へ残る。不在時の自動委任は無い |
| 差し戻し・出し直し・取消 | implemented | `op:resubmitEmployeeRequest` `op:cancelEmployeeRequest` `ui:packages/web/src/pages/RequestCenter.tsx` `test:packages/domain/src/approval/staged-request.test.ts` `e2e:e2e/request-center.spec.ts` | 出し直すと 1 段目からやり直し、前の提出の決裁も台帳に残る。申請の画面から行える |
| 承認結果の休暇台帳への反映 | implemented | `op:decideEmployeeRequest` `test:packages/api/test/integration/employee-request.test.ts` `migration:0039_allow_multi_day_leave_consumption.sql` | 承認しきった休暇の申請だけを、同じトランザクションで消化する。複数日の申請は対象の日数ぶんを日ごとの記録として原子的に引く。予定が休みの日は引かない |
| 承認結果の勤怠への反映 | implemented | `op:decideEmployeeRequest` `test:packages/api/test/integration/request-attendance-effect.test.ts` | 残業・休日出勤・打刻修正を、承認しきった時点だけ日次へ効かせる。締め済みの期間を含む申請は承認を断る |
| 利用者への通知 | implemented | `op:listNotifications` `op:markNotificationsRead` `test:packages/api/test/integration/notifications.test.ts` `ui:packages/web/src/pages/NotificationPanel.tsx` | 申請・承認・差し戻し・取消・代理承認を、製品内で届ける。正本は DB に残す |

## 締めと監査

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 月次の締めと締め解除 | implemented | `op:closeMonth` `op:reopenMonth` `ui:packages/web/src/admin/sections/ClosingReadinessSettings.tsx` `test:packages/domain/src/approval/monthly-closing.test.ts` `e2e:e2e/monthly-closing.spec.ts` | 残っているものを見てから締める。締め解除は理由を求める |
| 締める前の確認（未打刻・未申請・未承認） | implemented | `op:listClosingReadiness` `test:packages/domain/src/approval/closing-readiness.test.ts` `test:packages/api/test/integration/monthly-reporting.test.ts` `test:e2e/golden-path.spec.ts` | 実務が止まるものと参考のものを分ける。締めは止めない |
| 締めた時点の集計の固定 | implemented | `migration:0031_create_monthly_snapshots.sql` `test:packages/api/test/integration/monthly-reporting.test.ts` | 追記のみ。締め直すと新しい記録を積む |
| 月次の集計 | implemented | `op:listMonthlySummaries` `test:packages/domain/src/attendance/monthly.test.ts` `test:packages/api/test/integration/monthly-reporting.test.ts` | 日次から導く。1 日でも閾値が未設定なら、その区分は 0 ではなく未設定 |
| 設定を直したあとの再計算 | implemented | `op:recalculateAttendance` `test:packages/api/test/integration/monthly-reporting.test.ts` | 締めた月は動かさない。入力が変わらなければ新しい版を作らない |
| 締めたあとの編集の制御 | implemented | `migration:0006_create_requests_and_closings.sql` `test:packages/domain/src/approval/monthly-closing.test.ts` `test:packages/api/test/integration/monthly-reporting.test.ts` `test:e2e/golden-path.spec.ts` | 締め済みの期間は黙って書き換えない |
| 打刻の修正・取消・追加 | implemented | `op:correctAttendance` `test:packages/domain/src/attendance/corrections.test.ts` `migration:0004_add_attendance_corrections.sql` `test:packages/api/test/integration/attendance-corrections.test.ts` `test:e2e/golden-path.spec.ts` | 理由必須、元の記録は残る |
| 過去日の訂正 | implemented | `op:correctAttendance` `test:packages/domain/src/attendance/occurred-at.test.ts` `test:packages/api/test/integration/attendance-corrections.test.ts` | 400 日前まで遡って直せる。締め済みの期間は断る |
| 監査記録の閲覧 | partial | `op:listAuditLogs` `test:packages/api/test/integration/audit.test.ts` | 誰がいつ何を変えたかを追える。**API のみで、読むための画面が無い** |
| 異常の検出と根拠つきの表示 | implemented | `op:listAnomalies` `test:packages/domain/src/audit/anomaly.test.ts` `ui:packages/web/src/pages/AnomalyPanel.tsx` | 確定後の変更・大量修正・時計差・連番欠落・重複打刻 |

## 端末

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 端末の登録・失効と受領記録 | partial | `op:registerDevice` `op:enrollDevice` `op:revokeDevice` `op:listDeviceReceipts` `test:packages/api/test/integration/device.test.ts` | 登録トークンに有効期限がある。**API のみで、登録・失効の画面が無い** |
| 端末シミュレーターによる打刻の確認 | implemented | `test:packages/agent/src/client.test.ts` `test:packages/api/test/integration/agent-package.test.ts` | 実機なしで取り決めを確かめられる |
| IC カードの登録・失効 | partial | `op:createCardRegistration` `op:revokeCardCredential` `op:listCardCredentials` `test:packages/api/test/integration/card.test.ts` | 指紋だけを保存する。**API のみで、登録・失効の画面が無い** |
| 端末の常駐と送信待ちの保管 | implemented | `test:packages/api/test/integration/card-station.test.ts` `test:packages/api/test/integration/agent-package.test.ts` | 1 件 1 ファイルで書き、落ちても消えない。連番は積むときに決めるため、応答を失っても次の打刻が壊れない |
| 端末のログの秘匿 | partial | `test:packages/agent/src/service/redact.test.ts` | 秘匿の規則は固定しているが、**常駐した端末のログを実機で確かめていない** |
| 端末の診断 | partial | `test:packages/agent/src/service/spool.test.ts` | 送信待ちの状態を読める。**実機での確認は済んでいない** |
| Windows のサービスとしての登録・削除 | partial | `test:packages/api/test/integration/agent-package.test.ts` `docs:operations/device-agent-service.md` | 手順と配布物を作る仕組みはある。**実機での起動と再起動は未確認** |
| 物理の IC カードでの打刻 | partial | `test:packages/agent/src/card/pcsc.test.ts` `test:packages/api/test/integration/card-station.test.ts` `docs:operations/device-agent-service.md` | PC/SC を 1 つの対応先として実装し、受け渡しを配布物へ同梱した。`pnpm agent station` が読み取りと送信を 1 つの常駐で行う。**実機の読み取り装置では未確認** |
| 端末の自動更新 | planned | - | 署名と配布の方式が決まってから（P26） |
| 打刻時の位置情報 | implemented | `op:listAttendanceLocations` `docs:operations/retention.md` `test:packages/api/test/integration/attendance-location.test.ts` `ui:packages/web/src/admin/sections/OrganizationSettings.tsx` | 保持期間は 400 日（訂正できる範囲と同じ）。打刻とは別の表に持ち、消しても打刻は残る |

## 画面

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| ログインと当日の勤怠・打刻・訂正 | implemented | `ui:packages/web/src/pages/SignInPage.tsx` `ui:packages/web/src/pages/TodayAttendance.tsx` | 日本語と英語 |
| 承認待ちの一覧と承認 | implemented | `ui:packages/web/src/pages/PendingApprovals.tsx` `op:listEmployeeRequests` `e2e:e2e/request-center.spec.ts` | いまの段が自分の番のものだけを列として出す。押しても断られる申請は混ぜない |
| 差異と異常の表示 | implemented | `ui:packages/web/src/pages/DiscrepancyPanel.tsx` `ui:packages/web/src/pages/AnomalyPanel.tsx` | 根拠つきで出す |
| 組織の一覧表示 | implemented | `ui:packages/web/src/admin/sections/OrganizationSettings.tsx` | 設定の画面から登録もできる |
| API キーの管理 | implemented | `ui:packages/web/src/pages/ApiKeys.tsx` | 作成・一覧・失効 |
| 本人のセッション一覧とログアウト | implemented | `ui:packages/web/src/pages/ActiveSessions.tsx` | 端末ごと・一括 |
| 勤怠時刻を拠点の時間帯で表示・入力する | implemented | `ui:packages/web/src/pages/TodayAttendance.tsx` `test:packages/web/src/time/zoned.test.ts` | 表示・入力とも拠点の時計で読む。存在しない現地時刻は保存させない |
| 上部のモジュール切替と左メニュー | implemented | `ui:packages/web/src/admin/AdminConsole.tsx` `test:e2e/admin-console.spec.ts` | どこを見ているかは URL に持つ。左右キーでモジュールを移れる |
| 組織・拠点・部門・従業員の設定画面 | implemented | `ui:packages/web/src/admin/sections/OrganizationSettings.tsx` `ui:packages/web/src/admin/sections/SiteSettings.tsx` `ui:packages/web/src/admin/sections/DepartmentSettings.tsx` `ui:packages/web/src/admin/sections/EmployeeSettings.tsx` `op:updateEmployee` `op:changeEmployeeStatus` `test:packages/api/test/integration/employee-lifecycle.test.ts` | 一覧・作成・写して作る・CSV。従業員の更新・休止・退職も画面から行える |
| 勤務区分・計算規則・労働形態の設定画面 | implemented | `ui:packages/web/src/admin/sections/WorkCategorySettings.tsx` `ui:packages/web/src/admin/sections/CalculationRuleSettings.tsx` `ui:packages/web/src/admin/sections/LaborSystemSettings.tsx` | 未設定の閾値は 0 ではなく未設定として出す |
| 休暇種別・台帳の設定画面 | implemented | `ui:packages/web/src/admin/sections/LeaveTypeSettings.tsx` `ui:packages/web/src/admin/sections/LeaveLedgerSettings.tsx` | 残数は台帳から組み立てた値として出す。付与と取消ができる |
| 申請種別と承認経路の設定画面 | implemented | `ui:packages/web/src/admin/sections/RequestTypeSettings.tsx` `test:e2e/admin-console.spec.ts` | 段ごとの承認者を画面から決められる。段数を直しても提出済みの申請は動かない |
| 一覧・写して作る・CSV を同じ形にする | implemented | `ui:packages/web/src/admin/SettingsSection.tsx` `test:packages/web/src/admin/resource.test.ts` | CSV の列は画面の表と同じ定義から作る |
| 権限と組織の範囲で設定画面の表示を変える | implemented | `ui:packages/web/src/admin/AdminConsole.tsx` `test:e2e/admin-console.spec.ts` | 見られない設定は節ごと出さない。入口も出さない |
| 設定の一括取り込み（CSV での投入） | implemented | `op:importEmployeesCsv` `op:importWorkCategoriesCsv` `op:importRequestTypesCsv` `op:importLeaveGrantsCsv` `ui:packages/web/src/admin/SettingsSection.tsx` `test:packages/api/test/integration/settings-import.test.ts` `test:packages/api/test/integration/settings-csv-roundtrip.test.ts` `e2e:e2e/admin-console.spec.ts` | 従業員・勤務区分・申請種別・休暇の付与。どれも設定の画面から取り込める。取り出しは表示用と取込用を分け、取込用はそのまま戻せる。1 行でも読めなければ 1 行も取り込まない |
| 日次・月次の一覧とレポート | implemented | `op:listAttendanceDays` `ui:packages/web/src/pages/AttendanceHistory.tsx` `e2e:e2e/attendance-history.spec.ts` `test:packages/api/test/integration/attendance-days.test.ts` `op:listMonthlySummaries` `op:listPeriodSummaries` `op:listOvertimeWarnings` `op:listLeaveRegister` `test:packages/api/test/integration/overtime-warnings.test.ts` | 月の日ごとの勤怠を画面から辿れる。日を選ぶと、その日の記録と編集の可否が出る。月次・期間・長時間労働の警告・休暇管理簿も一覧できる |
| WCAG 2.2 AA | partial | `test:e2e/accessibility.spec.ts` | axe で AA まで機械的に見る（違反 0 件）。色の意味・読み上げの分かりやすさ・操作の順序は人が確かめる必要がある |
| 主要な系統での動作 | implemented | `test:e2e/cross-browser.spec.ts` | Chromium・Firefox・WebKit の 3 系統。系統差が出る操作に絞って流す |
| 見た目の回帰 | partial | `test:e2e/cross-browser.spec.ts` | 読み上げの木を文字として比べる。画像は差分で中身を読めないため追跡しない |

## 外部連携と出力

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| 日次勤怠の CSV 出力 | implemented | `op:exportAttendanceCsv` `test:packages/domain/src/integration/csv.test.ts` `test:packages/api/test/integration/integration.test.ts` | 表計算で数式として動かない形で出す |
| 従業員の CSV 取込 | implemented | `op:importEmployeesCsv` `test:packages/api/test/integration/integration.test.ts` | 全行を先に確かめ、1 つのトランザクションで作る。1 行でも取り込めなければ 1 件も作らず、位置つきで理由を返す |
| API キーとスコープ | implemented | `op:createApiKey` `op:revokeApiKey` `test:packages/domain/src/integration/api-key-usage.test.ts` `test:packages/api/test/integration/integration.test.ts` `test:e2e/api-key-console.spec.ts` | 生の鍵は作成時に 1 度だけ返す |
| Webhook の署名と送信先の制約 | implemented | `op:createWebhookEndpoint` `op:listWebhookDeliveries` `migration:0014_create_webhook_outbox.sql` `test:packages/api/test/integration/webhook-outbox.test.ts` `test:packages/api/test/integration/webhook-endpoint-network.test.ts` | 送信待ちは業務処理と同じトランザクションで積む。送信先を登録する画面は無く、API から登録する |
| connector SDK | implemented | `test:packages/connector/src/index.test.ts` `test:packages/api/test/integration/integration.test.ts` | 外部連携を作るための足場 |
| 給与連携の CSV 出力 | implemented | `op:exportPayrollCsv` `ui:packages/web/src/admin/sections/ClosingReadinessSettings.tsx` `test:packages/api/test/integration/monthly-reporting.test.ts` `e2e:e2e/monthly-closing.spec.ts` | 締めた月は締めた時点の値を出す。設定の画面から取り出せる |
| Webhook の自動再送とデッドレター | implemented | `op:listAbandonedDeliveries` `op:requeueAbandonedDelivery` `test:packages/domain/src/integration/retry.test.ts` `test:packages/api/test/integration/webhook-outbox.test.ts` | 間隔を広げながら送り直し、諦めた行は残す。人が手で送り直せる |
| 送り直す意味のある失敗の見分け | implemented | `test:packages/domain/src/integration/retry.test.ts` `test:packages/api/test/integration/webhook-outbox.test.ts` | 要求そのものを断られたものは送り直さない |

## 認証と利用者

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| メールアドレスとパスワードのログイン | implemented | `op:login` `op:logout` `test:packages/domain/src/identity/login-attempts.test.ts` `test:packages/api/test/integration/login-attempts.test.ts` `test:packages/api/test/integration/auth.test.ts` | 試行回数の制限つき |
| 本人によるセッションの一覧と失効 | implemented | `op:listSessions` `op:revokeSession` `op:revokeOtherSessions` `test:packages/domain/src/identity/session.test.ts` `test:packages/api/test/integration/session-management.test.ts` |  |
| パスワードの変更 | implemented | `op:changePassword` `test:packages/domain/src/identity/credentials.test.ts` `test:packages/api/test/integration/auth.test.ts` |  |
| ロールによる権限制御 | implemented | `test:packages/domain/src/identity/roles.test.ts` `test:packages/api/test/integration/employee-visibility.test.ts` | ワークスペース管理者・組織管理者・従業員 |
| 契約・配属・閲覧範囲 | implemented | `op:createAssignmentContract` `op:createEmployeeAssignment` `op:grantUserScope` `test:packages/domain/src/organization/assignment.test.ts` `test:packages/api/test/integration/assignment.test.ts` | 期間付きで持つ |
| 日本語と英語の切り替え | implemented | `op:updatePreferences` `test:packages/domain/src/i18n/locale.test.ts` `ui:packages/web/src/i18n/LocaleProvider.tsx` `test:e2e/punch.spec.ts` |  |
| 管理者による他の利用者のセッション失効 | implemented | `op:revokeUserSessions` `test:packages/api/test/integration/session-management.test.ts` | 退職・端末紛失のとき、本人が操作できなくても終わらせられる |
| 管理者によるパスワードの再設定 | implemented | `op:resetUserPassword` `test:packages/api/test/integration/session-management.test.ts` | 再設定するとセッションも終わる。本人が入れなくなったときの復旧 |
| 招待・パスワード再設定の自己申請・メールアドレス変更 | planned | - | 送信の仕組みを持たない。管理者が作り、初回のパスワードを渡す（v0.1 の範囲外） |
| MFA・SSO | planned | - | v0.1 の範囲外。パスワードとログインの回数制限で守る |

## 運用

| 能力 | 状態 | 根拠 | 備考 |
| --- | --- | --- | --- |
| バックアップと復元 | implemented | `script:scripts/backup.sh` `script:scripts/restore.sh` `test:packages/api/test/integration/backup-scripts.test.ts` | 手順と脚本がある |
| SBOM の生成と検証 | implemented | `script:scripts/generate-sbom.sh` `script:scripts/verify-sbom.mjs` `test:test/release-assets.test.ts` | 配布物の構成を出せる |
| マイグレーションの検証 | implemented | `test:packages/db/src/migrator.test.ts` `test:packages/api/test/integration/migration-concurrency.test.ts` | 二重適用・内容変更・DB 名の誤指定を止める |
| 書き出しと復元の突き合わせ | implemented | `test:scripts/verify-restore.sh` `test:packages/api/test/integration/backup-scripts.test.ts` | 46 テーブルの行数と中身の要約が一致することを CI で見る |
| 定期的な復元の演習（実運用のデータでの） | planned | - | 自動の突き合わせはあるが、実運用のデータでの演習は別に要る |
| 構造化ログ | partial | `test:packages/agent/src/service/redact.test.ts` | 秘匿の規則は固定しているが、**運用の経路で出る形を縦に通していない** |
| 稼働の確認 | implemented | `test:packages/api/test/integration/load-and-faults.test.ts` | データベースへ届かないとき、生存は返し受け入れ可否は不調にする |
| メトリクス・アラート | planned | - | v0.1 の範囲外。構造化ログを既存のログ基盤で拾う |
| Row-Level Security | planned | - | アプリ側の認可が正本。採否を決める（P25） |
| データの保持の取り決め | implemented | `docs:operations/retention.md` `op:changeEmployeeStatus` `test:packages/api/test/integration/employee-lifecycle.test.ts` | 何をいつまで持つか、消してはいけないもの、退職者の扱いを決めた。退職の手順は 1 つの操作にまとめ、SQL を求めない |
| 保持期間を過ぎたデータの削除 | implemented | `script:packages/api/src/cli/run-retention.ts` `test:packages/api/test/integration/retention.test.ts` `docs:operations/retention.md` | 事前確認と実行を持つ command。消した件数を同じトランザクションで監査へ残す。保持する日数は渡した値だけを使い、渡さなかった対象は消さない。定期実行の仕組みは cron などに委ねる |
| 配布物の checksum と出所の対応 | implemented | `script:scripts/release-assets.sh` `script:scripts/verify-release-assets.mjs` `test:test/release-assets.test.ts` | 版・commit・checksum・構成一覧の対応を、配る前に突き合わせる |
| 配る前の必須ゲート | implemented | `script:scripts/verify-release-checks.mjs` `test:packages/api/test/integration/release-checks.test.ts` | tag の SHA で必須の workflow が成功していることと、tag と package の版の一致を、Release の workflow が確かめる。判断に要るものが欠けていれば通さない |
| 配布物の署名 | planned | - | 署名には所有者の鍵が要る。鍵を持たない者の署名は「誰が配ったか」を示せない |
| 負荷試験・障害注入 | partial | `test:packages/api/test/integration/load-and-faults.test.ts` | 同時の打刻、1 か月ぶんの集計、監査の失敗、DB 断を再現できる形で確かめる。実運用の規模での負荷試験はしていない |
| 給与計算そのもの | non-goal | - | 計算した勤務時間を出すところまでを範囲とし、賃金の計算は連携先に委ねる |
| 労働法令への適合の保証 | non-goal | - | 実装した計算の範囲は示すが、規程に合っているかは導入する側で確かめる |
| 公開デモ環境 | non-goal | - | 手元で `pnpm seed:demo` を使う。常時動く環境の運用は負担に見合わない |
| SaaS の運用（このリポジトリが配るもの） | non-goal | - | 配るのはセルフホスト用の一式だけで、運用する側にはならない。コードが SaaS として動けること自体は設計要件として持ち続ける（ワークスペース分離） |
| マイクロサービス・Kubernetes・Redis・Kafka | non-goal | - | 単一の PostgreSQL と Docker Compose で起動できることを優先する |
