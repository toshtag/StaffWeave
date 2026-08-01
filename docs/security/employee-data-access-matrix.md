# 従業員データの認可マトリクス

`packages/api/src/**/routes.ts` に定義されている全ルートについて、
誰が何を取得できるかを一覧にします。認可を変えたときは、この表も同時に更新します。

## 閲覧範囲のモデル

閲覧範囲は `EmployeeVisibility`（`packages/domain/src/organization/assignment.ts`）で表します。
ロールと閲覧範囲から `resolveEmployeeVisibility` が決め、
API 層の `EmployeeVisibilityGuard`（`packages/api/src/shared/employee-visibility.ts`）が適用します。

| ロール | 見られる従業員 |
| --- | --- |
| `workspace_admin` | ワークスペース全体 |
| `organization_manager` | 与えられた閲覧範囲の組織が雇用元または受入組織である従業員。範囲が空なら管理対象なし。加えて自分自身。 |
| `employee` | 自分自身のみ |
| 従業員が紐づかない一般利用者 | なし |

**空の閲覧範囲は「すべて」ではありません。** 空配列に「全件」と「ゼロ件」の
2 つの意味を持たせると、閲覧範囲をまだ与えられていない組織管理者が
ワークスペース全体を見られてしまいます。全体を見られるかはロールだけで決めます。

API キーはワークスペース単位のスコープであり、組織単位の制限を持ちません。
API キーで呼べる出力は、そのワークスペースの全従業員を対象とします。
組織単位の制限を API キーへ追加するかどうかは、P15 以降の判断に残しています。

適用の形は 3 つです。

- **一覧を絞る**: `filterVisible` で、見てよい行だけを返す。
- **対象を検査する**: `requireVisibleEmployee` で、範囲外なら `403`。`404` へは偽装しない。
- **SQL で絞る**: `employeeVisibilityCondition` で、件数が多い出力を DB の側で絞り込む。

## 期間の扱い

雇用元は期間で絞りません。所属している限り、雇用元はその従業員を自社の従業員として扱います。
退職者も所属が残っているあいだは雇用元から見えます。

受入組織は、配属と契約の両方が続いているあいだだけ関わりを持ちます。
開始前と終了後は見られません。判断に使う期間は経路の種類で決めます。

| 経路の種類 | 基準にする期間 | 例 |
| --- | --- | --- |
| 期間を持たない | 現在日（ワークスペースの時間帯） | `listEmployees`, `listCardCredentials`, `listEmployeeAssignments`, `listEmployeeWorkCycles` |
| 1 日を対象にする | その業務日 | `getDiscrepancyReport`, 申請の承認・差し戻し |
| 期間を対象にする | 対象期間と重なるか | `listWorkSchedules`, `listSessionObservations`, `listDailyRequests`, `listMonthlyClosings`, `listAnomalies` の事前検査 |
| 行ごとに日付を持つ | 行の業務日 | `listDailyRequests`, `listSessionObservations`, `listAnomalies` の絞り込み、`exportAttendanceCsv` |
| 月を対象にする | その月のいずれかの日 | `listMonthlyClosings` の絞り込み、`closeMonth`, `reopenMonth`, `exportPayrollCsv` |

期間を対象にする経路では、事前検査を「期間と重なるか」で行い、
行ごとの絞り込みで実際に見せる範囲を決めます。
検査だけを通っても、配属されていなかった日の行は返しません。

`from` / `to` を受け取る経路を「期間を持たない」側へ入れないでください。
現在日で判断すると、配属される前や終わった後の期間まで読めてしまいます。

契約終了後の猶予期間は設けません。締めや給与の処理が終わっていない場合は、
配属の終了日を実態に合わせて設定してください。

## 記号

| 記号 | 意味 |
| --- | --- |
| 全件 | ワークスペース全体を取得できる |
| 範囲内 | 閲覧範囲の組織に関わる従業員だけを取得できる |
| 自分 | 自分自身の分だけを取得できる |
| なし | 取得できない（`403`） |
| — | 従業員データを返さない、または該当しない |

## 従業員データを返すルート

| operationId | method | path | 返すデータ | 必要 permission | Workspace 管理者 | 組織管理者 | 一般従業員 | API キー | 認可実装箇所 | 負のテスト |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listEmployees` | GET | `/employees` | 従業員の一覧 | `employee.read` | 全件 | 範囲内 | なし | — | `organization/service.ts` `listEmployees` | ✅ |
| `listDailyRequests` | GET | `/attendance/requests` | 日次申請 | なし（本人は自分のみ） | 全件 | 範囲内 | 自分 | — | `approval/service.ts` `listRequests` | ✅ |
| `approveDailyRequest` | POST | `/attendance/requests/{requestId}/approve` | 申請の状態 | `attendance.approve` | 全件 | 範囲内 | なし | — | `approval/service.ts` `decide` | ✅ |
| `returnDailyRequest` | POST | `/attendance/requests/{requestId}/return` | 申請の状態 | `attendance.approve` | 全件 | 範囲内 | なし | — | `approval/service.ts` `decide` | ✅ |
| `cancelDailyRequest` | POST | `/attendance/requests/{requestId}/cancel` | 申請の状態 | なし（本人のみ） | 自分 | 自分 | 自分 | — | `approval/service.ts` `decide` | ✅ |
| `listMonthlyClosings` | GET | `/monthly-closings` | 月次締め | なし（本人は自分のみ） | 全件 | 範囲内 | 自分 | — | `approval/service.ts` `listClosings` | ✅ |
| `closeMonth` | POST | `/monthly-closings/close` | 月次締め | `attendance.close` | 全件 | なし | なし | — | `approval/service.ts` `close` | ✅ |
| `reopenMonth` | POST | `/monthly-closings/reopen` | 月次締め | `attendance.close` | 全件 | なし | なし | — | `approval/service.ts` `reopen` | ✅ |
| `listWorkSchedules` | GET | `/work-schedules` | 勤務予定 | `employee.read` | 全件 | 範囲内 | なし | — | `schedule/service.ts` `listWorkSchedules` | ✅ |
| `listEmployeeWorkCycles` | GET | `/employee-work-cycles` | 勤務周期割当 | `employee.read` | 全件 | 範囲内 | なし | — | `schedule/service.ts` `listAssignments` | ✅ |
| `listSessionObservations` | GET | `/session-observations` | PC の利用記録 | なし（本人は自分のみ） | 全件 | 範囲内 | 自分 | — | `session/service.ts` `listObservations` | ✅ |
| `getDiscrepancyReport` | GET | `/attendance/days/{businessDate}/discrepancies` | 打刻と PC 記録の乖離 | なし（本人は自分のみ） | 全件 | 範囲内 | 自分 | — | `session/service.ts` `getDiscrepancyReport` | ✅ |
| `listAnomalies` | GET | `/audit/anomalies` | 異常（従業員分・端末分） | `employee.read` | 全件 | 範囲内 | なし | — | `audit/anomaly-service.ts` `list` | ✅ |
| `listEmployeeAssignments` | GET | `/employee-assignments` | 配属 | `employee.read` | 全件 | 範囲内 | なし | — | `organization/assignment-service.ts` `listAssignments` | ✅ |
| `listCardCredentials` | GET | `/card-credentials` | IC カードの資格情報 | `employee.read` | 全件 | 範囲内 | なし | — | `card/service.ts` `listCredentials` | ✅ |
| `exportAttendanceCsv` | GET | `/exports/attendance.csv` | 日次の勤怠（氏名・従業員番号つき） | `employee.read` または `attendance:read` | 全件 | 範囲内 | なし | 全件 | `integration/routes.ts` `resolveExportTarget` → `export-service.ts` | ✅ |
| `exportPayrollCsv` | GET | `/exports/payroll.csv` | 月次の集計（氏名・従業員番号つき） | `employee.read` または `payroll:read` | 全件 | 範囲内 | なし | 全件 | `integration/routes.ts` `resolveExportTarget` → `export-service.ts` | ✅ |
| `getTodayAttendance` | GET | `/attendance/today` | 自分の当日 | なし | 自分 | 自分 | 自分 | — | `attendance/service.ts` `getToday` | 既存 |
| `getAttendanceDay` | GET | `/attendance/days/{businessDate}` | 自分の指定日 | なし | 自分 | 自分 | 自分 | — | `attendance/service.ts` `getDay` | 既存 |

`listAnomalies` の端末に紐づく異常（時計差・連番欠落・拒否イベント）は、
特定の従業員のものではないため閲覧範囲では絞りません。

`closeMonth` と `reopenMonth` は `attendance.close` を必要とします。この権限を持つのは
`workspace_admin` だけです（`packages/domain/src/identity/roles.ts`）。
組織管理者は閲覧範囲の検査に到達する前に権限で止まります。
組織管理者へ締めを許す場合は、閲覧範囲の検査がそのまま効きます。

## 従業員データを変更するルート

いずれも `employee.manage` を必要とします。`employee.manage` は `workspace_admin` だけが持つため、
組織管理者は到達しません。閲覧範囲の適用は行っていません。

| operationId | method | path | 必要 permission | 備考 |
| --- | --- | --- | --- | --- |
| `createEmployee` | POST | `/employees` | `employee.manage` | — |
| `upsertWorkSchedule` | PUT | `/work-schedules` | `employee.manage` | — |
| `assignWorkCycle` | POST | `/employee-work-cycles` | `employee.manage` | — |
| `endWorkCycleAssignment` | POST | `/employee-work-cycles/{employeeWorkCycleId}/end` | `employee.manage` | 期間の重なりを避けるための終了日 |
| `generateWorkSchedules` | POST | `/work-schedules/generate` | `employee.manage` | — |
| `createEmployeeAssignment` | POST | `/employee-assignments` | `employee.manage` | — |
| `endEmployeeAssignment` | POST | `/employee-assignments/{employeeAssignmentId}/end` | `employee.manage` | 期間の重なりを避けるための終了日 |
| `createCardRegistration` | POST | `/card-credentials/registrations` | `employee.manage` | — |
| `revokeCardCredential` | POST | `/card-credentials/{cardCredentialId}/revoke` | `employee.manage` | — |
| `importEmployeesCsv` | POST | `/imports/employees` | `employee.manage` | — |

組織管理者へ従業員の編集を許す場合は、ここへ閲覧範囲の適用が必要になります。
現時点ではロールで到達を止めているだけであり、範囲の検査は入っていません。

## 従業員データを返さないルート

| operationId | method | path | 必要 permission | 備考 |
| --- | --- | --- | --- | --- |
| `login` / `logout` | POST | `/auth/login`, `/auth/logout` | — | 認証そのもの |
| `getSession` | GET | `/auth/session` | 認証のみ | 自分の情報だけを返す |
| `updatePreferences` | PATCH | `/auth/preferences` | 認証のみ | 自分の設定だけを変える |
| `listOrganizations` / `listSites` / `listDepartments` | GET | `/organizations`, `/sites`, `/departments` | `organization.read` | 組織構造。従業員は含まない |
| `createOrganization` / `createSite` / `createDepartment` | POST | 同上 | `organization.manage` | — |
| `listWorkPatterns` / `listLeaveTypes` / `listWorkCycles` | GET | `/work-patterns`, `/leave-types`, `/work-cycles` | `organization.read` | 制度の定義。従業員は含まない |
| `createWorkPattern` / `createLeaveType` / `createWorkCycle` | POST | 同上 | `organization.manage` | — |
| `listAssignmentContracts` | GET | `/assignment-contracts` | `organization.read` | 組織間の契約。従業員は含まない |
| `createAssignmentContract` | POST | `/assignment-contracts` | `organization.manage` | — |
| `listUserScopes` / `grantUserScope` | GET / POST | `/user-scopes` | `user.manage` | 閲覧範囲そのものの管理 |
| `listAuditLogs` | GET | `/audit/logs` | `audit.read` | ワークスペース管理者のみ。上の「監査記録」を参照 |
| `listDevices` / `listDeviceReceipts` | GET | `/devices`, `/devices/{deviceId}/receipts` | `organization.read` | 端末と受領記録 |
| `registerDevice` / `revokeDevice` | POST | `/devices`, `/devices/{deviceId}/revoke` | `organization.manage` | — |
| `listApiKeys` / `createApiKey` | GET / POST | `/api-keys` | `user.manage` | — |
| `listWebhookEndpoints` / `createWebhookEndpoint` | GET / POST | `/webhook-endpoints` | `user.manage` | — |
| （未登録） | POST | `/api-keys/{apiKeyId}/revoke` | `user.manage` | OpenAPI に未登録 |
| （未登録） | GET | `/webhook-deliveries` | `user.manage` | OpenAPI に未登録 |
| `recordAttendanceEvent` / `correctAttendance` / `submitDailyRequest` | POST | `/attendance/events`, `/attendance/corrections`, `/attendance/requests` | 認証のみ | 自分の分だけを登録する |
| `enrollDevice` / `recordDeviceEvent` / `registerCard` / `recordCardEvent` / `recordSessionObservations` | POST | `/device-agent/*` | 端末の署名 | セッションを使わない |
| — | GET | `/health`, `/ready`, `/openapi.json` | — | 認証不要 |

## 監査記録

`listAuditLogs`（`GET /audit/logs`）はワークスペース管理者だけが読めます（`audit.read`）。

記録には従業員に紐づかない操作（端末の登録、API キーの発行、Webhook の設定）が混ざり、
`summary` は自由文で氏名がそのまま入ります。従業員 ID で絞っても、
要約に他の従業員の名前が含まれる記録を機械的に取り除けません。
そのため閲覧範囲での絞り込みは行わず、読める相手をロールで限ります。

組織管理者向けに範囲内の記録だけを見せる表示は、管理画面（P17）で扱います。

## 歴史的な記録

`packages/db/migrations/0012_create_assignments_and_scopes.sql` のコメントには、
作成時点の旧設計が残っています。閲覧範囲の行がないことを管理者の印として扱う、
という前提に立った説明です。

現在の認可契約では、空の組織スコープは全件閲覧を意味しません。
適用済みのマイグレーションはチェックサム保護のため書き換えないので、
このコメントは当時の設計を示す記録として残します。

同じ説明が他のファイルへ再び入り込まないよう、`pnpm check:policy` に検査を置いています。
例外はこの 1 ファイルだけで、例外側の件数もちょうど 1 件であることを検査します。
この文書を含め、他のどのファイルにも旧説明を書き写さないでください
（説明が必要な場合は、この節のように言い換えてください）。

## 検証

負のテストは `packages/api/test/integration/employee-visibility.test.ts` にあります。
1 つのワークスペースに 3 つの組織（雇用元 A、雇用元 B、受入組織 H）を置き、
次の 5 者から同じ経路を叩いて確かめています。

- ワークスペース管理者
- 組織 A の管理者（閲覧範囲あり、雇用元として閲覧）
- 受入組織 H の管理者（閲覧範囲あり、配属だけを根拠に閲覧）
- 閲覧範囲を持たない組織管理者（従業員が紐づく場合と、紐づかない場合）
- 一般従業員

CSV は SQL 側で絞り込むため、インメモリの判定とは別実装になります。
受入組織を経由する許可と、本人だけを見る場合の 2 つの分岐を、CSV でも検証しています。

配属の期間については、終了済み・期間内・開始前の 3 通りを別の従業員で用意し、
従業員一覧・勤怠 CSV・給与 CSV・勤務予定・異常の一覧のそれぞれで、
期間内の従業員だけが見えることを確かめています。

異常の一覧は業務日を持つため、対象期間を変えると見える相手が変わります。
終了した配属の期間を指定したときにその期間の異常が返り、
配属される前の期間を指定したときに返らないことを、事前検査と絞り込みの両方で確かめています。

閲覧範囲のモデルを旧動作へ戻すか、いずれかの絞り込みを外すと、このテストは失敗します。
