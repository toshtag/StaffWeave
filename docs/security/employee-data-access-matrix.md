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
| `closeMonth` | POST | `/monthly-closings/close` | 月次締め | `attendance.close` | 全件 | 範囲内 | なし | — | `approval/service.ts` `close` | ✅ |
| `reopenMonth` | POST | `/monthly-closings/reopen` | 月次締め | `attendance.close` | 全件 | 範囲内 | なし | — | `approval/service.ts` `reopen` | ✅ |
| `listWorkSchedules` | GET | `/work-schedules` | 勤務予定 | `employee.read` | 全件 | 範囲内 | なし | — | `schedule/service.ts` `listWorkSchedules` | ✅ |
| `listEmployeeWorkCycles` | GET | `/employee-work-cycles` | 勤務周期割当 | `employee.read` | 全件 | 範囲内 | なし | — | `schedule/service.ts` `listAssignments` | ✅ |
| `listSessionObservations` | GET | `/session-observations` | PC の利用記録 | なし（本人は自分のみ） | 全件 | 範囲内 | 自分 | — | `session/service.ts` `listObservations` | ✅ |
| `getDiscrepancyReport` | GET | `/attendance/days/{businessDate}/discrepancies` | 打刻と PC 記録の乖離 | なし（本人は自分のみ） | 全件 | 範囲内 | 自分 | — | `session/service.ts` `getDiscrepancyReport` | ✅ |
| `listAnomalies` | GET | `/audit/anomalies` | 異常（従業員分・端末分） | `employee.read` | 全件 | 範囲内 | なし | — | `audit/anomaly-service.ts` `list` | ✅ |
| `listEmployeeAssignments` | GET | `/employee-assignments` | 配属 | `employee.read` | 全件 | 範囲内 | なし | — | `organization/assignment-service.ts` `listAssignments` | ✅ |
| `listCardCredentials` | GET | `/card-credentials` | IC カードの資格情報 | `employee.read` | 全件 | 範囲内 | なし | — | `card/service.ts` `listCredentials` | 未 |
| `exportAttendanceCsv` | GET | `/exports/attendance.csv` | 日次の勤怠（氏名・従業員番号つき） | `employee.read` または `attendance:read` | 全件 | 範囲内 | なし | 全件 | `integration/routes.ts` `resolveExportTarget` → `export-service.ts` | ✅ |
| `exportPayrollCsv` | GET | `/exports/payroll.csv` | 月次の集計（氏名・従業員番号つき） | `employee.read` または `payroll:read` | 全件 | 範囲内 | なし | 全件 | `integration/routes.ts` `resolveExportTarget` → `export-service.ts` | ✅ |
| `getTodayAttendance` | GET | `/attendance/today` | 自分の当日 | なし | 自分 | 自分 | 自分 | — | `attendance/service.ts` `getToday` | 既存 |
| `getAttendanceDay` | GET | `/attendance/days/{businessDate}` | 自分の指定日 | なし | 自分 | 自分 | 自分 | — | `attendance/service.ts` `getDay` | 既存 |

`listAnomalies` の端末に紐づく異常（時計差・連番欠落・拒否イベント）は、
特定の従業員のものではないため閲覧範囲では絞りません。

## 従業員データを変更するルート

いずれも `employee.manage` を必要とします。`employee.manage` は `workspace_admin` だけが持つため、
組織管理者は到達しません。閲覧範囲の適用は行っていません。

| operationId | method | path | 必要 permission | 備考 |
| --- | --- | --- | --- | --- |
| `createEmployee` | POST | `/employees` | `employee.manage` | — |
| `upsertWorkSchedule` | PUT | `/work-schedules` | `employee.manage` | — |
| `assignWorkCycle` | POST | `/employee-work-cycles` | `employee.manage` | — |
| `generateWorkSchedules` | POST | `/work-schedules/generate` | `employee.manage` | — |
| `createEmployeeAssignment` | POST | `/employee-assignments` | `employee.manage` | — |
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
| `listDevices` / `listDeviceReceipts` | GET | `/devices`, `/devices/{deviceId}/receipts` | `organization.read` | 端末と受領記録 |
| `registerDevice` / `revokeDevice` | POST | `/devices`, `/devices/{deviceId}/revoke` | `organization.manage` | — |
| `listApiKeys` / `createApiKey` | GET / POST | `/api-keys` | `user.manage` | — |
| `listWebhookEndpoints` / `createWebhookEndpoint` | GET / POST | `/webhook-endpoints` | `user.manage` | — |
| （未登録） | POST | `/api-keys/{apiKeyId}/revoke` | `user.manage` | OpenAPI に未登録 |
| （未登録） | GET | `/webhook-deliveries` | `user.manage` | OpenAPI に未登録 |
| `recordAttendanceEvent` / `correctAttendance` / `submitDailyRequest` | POST | `/attendance/events`, `/attendance/corrections`, `/attendance/requests` | 認証のみ | 自分の分だけを登録する |
| `enrollDevice` / `recordDeviceEvent` / `registerCard` / `recordCardEvent` / `recordSessionObservations` | POST | `/device-agent/*` | 端末の署名 | セッションを使わない |
| — | GET | `/health`, `/ready`, `/openapi.json` | — | 認証不要 |

## 未解決

### 監査ログに閲覧範囲を適用していない

`listAuditLogs`（`GET /audit/logs`、`organization.read`）は、ワークスペース全体の監査記録を返します。
記録の `summary` には従業員の氏名が含まれることがあります。

組織管理者に監査記録を見せるべきかどうかは、業務上の判断を要します。
「範囲内の従業員に関する記録だけを見せる」のか、「そもそも見せない」のかで扱いが変わり、
記録には従業員に紐づかない操作（端末の登録、API キーの発行など）も混ざります。

この判断は今回の共通修正の対象外とし、別途 Issue として記録しています。

### IC カードの資格情報に負のテストがない

`listCardCredentials` には閲覧範囲を適用していますが、
組織をまたぐ負のテストをまだ書いていません。

## 検証

負のテストは `packages/api/test/integration/employee-visibility.test.ts` にあります。
1 つのワークスペースに 2 つの組織を置き、次の 4 者から同じ経路を叩いて確かめています。

- ワークスペース管理者
- 組織 A の管理者（閲覧範囲あり）
- 閲覧範囲を持たない組織管理者（従業員が紐づく場合と、紐づかない場合）
- 一般従業員

閲覧範囲のモデルを旧動作へ戻すと、このテストは失敗します。
