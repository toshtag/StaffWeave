# 従業員データの認可

誰の従業員データを誰が取得できるかを固定します。

経路そのもの、必要な permission、要求と応答の形は OpenAPI と
`packages/api/src/**/routes.ts` が正本です。ここへは写しません。
この文書が持つのは、コードの 1 か所を読んでも分からないもの
— 閲覧範囲のモデル、判断に使う期間、経路ごとに期待する範囲 — だけです。

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
組織単位の制限を API キーへ追加するかどうかは、必要になった時点で判断します。

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

## 経路ごとに期待する範囲

従業員データを返す経路が、ロールごとに何を返すかです。
`全件` はワークスペース全体、`範囲内` は閲覧範囲の組織に関わる従業員だけ、
`自分` は自分自身の分だけ、`なし` は `403`、`—` は該当しないことを表します。

| operationId | Workspace 管理者 | 組織管理者 | 一般従業員 | API キー |
| --- | --- | --- | --- | --- |
| `listEmployees` | 全件 | 範囲内 | なし | — |
| `listEmployeeAssignments` | 全件 | 範囲内 | なし | — |
| `listCardCredentials` | 全件 | 範囲内 | なし | — |
| `listWorkSchedules` | 全件 | 範囲内 | なし | — |
| `listEmployeeWorkCycles` | 全件 | 範囲内 | なし | — |
| `listAnomalies` | 全件 | 範囲内 | なし | — |
| `listDailyRequests` | 全件 | 範囲内 | 自分 | — |
| `listMonthlyClosings` | 全件 | 範囲内 | 自分 | — |
| `listSessionObservations` | 全件 | 範囲内 | 自分 | — |
| `getDiscrepancyReport` | 全件 | 範囲内 | 自分 | — |
| `approveDailyRequest` / `returnDailyRequest` | 全件 | 範囲内 | なし | — |
| `closeMonth` / `reopenMonth` | 全件 | なし | なし | — |
| `cancelDailyRequest` | 自分 | 自分 | 自分 | — |
| `getTodayAttendance` / `getAttendanceDay` | 自分 | 自分 | 自分 | — |
| `exportAttendanceCsv` | 全件 | 範囲内 | なし | 全件 |
| `exportPayrollCsv` | 全件 | 範囲内 | なし | 全件 |

`listAnomalies` の端末に紐づく異常（時計差・連番欠落・拒否イベント）は、
特定の従業員のものではないため閲覧範囲では絞りません。

`closeMonth` と `reopenMonth` で組織管理者が `なし` なのは、`attendance.close` を
`workspace_admin` しか持たないためで、閲覧範囲の検査へ到達する前に権限で止まります
（`packages/domain/src/identity/roles.ts`）。組織管理者へ締めを許す場合は、
閲覧範囲の検査がそのまま効きます。

従業員データを**変更する**経路（作成・更新・失効・CSV 取り込み）は、いずれも
`employee.manage` を必要とします。この権限も `workspace_admin` だけが持つため、
組織管理者は到達しません。閲覧範囲の適用は行っていないので、
組織管理者へ編集を許す場合はそこから足すことになります。

## 監査記録

`listAuditLogs`（`GET /audit/logs`）はワークスペース管理者だけが読めます（`audit.read`）。

記録には従業員に紐づかない操作（端末の登録、API キーの発行、Webhook の設定）が混ざり、
`summary` は自由文で氏名がそのまま入ります。従業員 ID で絞っても、
要約に他の従業員の名前が含まれる記録を機械的に取り除けません。
そのため閲覧範囲での絞り込みは行わず、読める相手をロールで限ります。

組織管理者向けに範囲内の記録だけを見せる表示は、管理画面の側で扱います。

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
