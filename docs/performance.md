# 問い合わせ回数の決めごと

staffweave が扱う量は、従業員数と運用年数に比例して増えます。
結果が正しくても、読む量や往復の回数が対象と無関係に増える実装は、
運用を続けるほど遅くなります。この文書は、その形を避けるための決めごとを残します。

対象は「同じ結果を、より少ない問い合わせで得る」判断だけです。
認可の規則、計算の内容、応答の形は変えません。

## 数に比例して往復を増やさない

一覧を組み立てるとき、行ごとに問い合わせを足さない。
必要な子の行は、対象をまとめて 1 回で読み、呼び出し側で振り分ける。

行ごとに引く形は、応答の内容が正しいままなので、レビューでもテストでも気付けません。
変わるのは問い合わせの回数だけです。

### 申請の状態遷移

日次申請（`daily_attendance_requests`）は、状態遷移（`attendance_request_transitions`）を
併せて返します。一覧では、対象の申請 ID をまとめて渡し、1 回で読みます。

```sql
SELECT request_id, from_state, to_state, event, actor_user_id, comment, occurred_at
  FROM attendance_request_transitions
 WHERE workspace_id = $1 AND request_id = ANY($2::uuid[])
 ORDER BY occurred_at, id
```

並び順は問い合わせが決め、振り分けでは順序を触りません。
`ORDER BY occurred_at, id` で読んだ結果を申請ごとに配ると、
申請の中での順序は 1 件ずつ読んだ場合と同じになります。

1 件だけを返す経路（`findRequest` / `findRequestById` / `saveRequest`）も同じ実装を通します。
経路ごとに書くと、片方だけが元の形へ戻ります。

対象の申請が 0 件なら、遷移は問い合わせません。

### 認証

認証は `/api` のすべての要求で通ります。ここでかかる往復は、
処理そのものが軽い要求（打刻の状態確認、セッションの確認）でも応答時間の下限になります。

セッション・ワークスペース・利用者・ロール・従業員・閲覧範囲は、
すべてセッションから外部キーでたどれます。分けて引く理由がないため、
`findSessionContextByTokenHash` の 1 回で読みます。

ロールと閲覧範囲は `array_agg(… ORDER BY …)` で集めます。
並び順は応答へそのまま出るため、分けて引いていたときと同じ順序にします。

セッションの延長は、要否を判断してから書きます（`shouldRenew`）。
要求のたびに書くと、読み取りだけの要求にも書き込みの待ち時間が乗ります。

### 繰り返しの中で変わらないもの

複数の日をまとめて処理する経路では、日ごとに変わらない問い合わせを繰り返しの外へ出します。
勤務予定の生成（`generateWorkSchedules`）は、次を期間ごとに 1 回だけ読みます。

| 読むもの | なぜ 1 回でよいか |
| --- | --- |
| 計算ルール（`calculation_rule_sets`） | ワークスペース単位の設定で、日によって変わらない |
| 業務日のタイムゾーン | 従業員の主たる拠点で決まり、日によって変わらない |
| すでにある予定（`work_schedules`） | 期間分をまとめて読み、日付の集合として持てる |

計算ルールは `recalculateWorkDay` の引数として渡します。
1 日分だけを処理する経路（打刻・修正・予定の変更）は、これまでどおり自分で読みます。

繰り返しの中は 1 つのトランザクションです。往復が増えるほど接続を長く占有し、
その間は掃除できない行が積み上がります。

### 閲覧範囲の判定

「誰の勤怠を見てよいか」の判定材料は、対象の従業員の分だけを読みます。
1 人を確かめるためにワークスペース全体の配属を読むと、
読む量が対象ではなく組織の大きさと運用年数で決まります。

- 従業員を指定する検査（`requireVisibleEmployee`）は、その 1 人だけを読む
- 一覧の絞り込み（`filterVisible`）は、一覧に載っている従業員だけを読む
- 一覧が従業員に紐づかない行だけなら、読まない

同じ要求で検査と絞り込みの両方を行う経路（異常の一覧など）では、
読んだ結果を要求の中で使い回します。使い回す範囲は認証コンテキストです。
コンテキストは要求ごとに作られるため、要求をまたいで残りません。
またいで残すと、配属の変更が反映されない時間ができます。

件数が多くなる出力（CSV）は、この形ではなく
`employeeVisibilityCondition` で SQL の条件として渡します。
読み込んでから捨てるのではなく、読まない形にします。

## 読み取りの要求で書き込まない

読み取りだけの要求に書き込みを混ぜない。
書き込みが確定するまで応答を返せないため、待ち時間がそのまま乗ります。
同じ行を書く要求どうしは、行ロックの待ちで直列化します。

「最後に使った時刻」のように、精度が要らない記録は、要否を判断してから書きます。

| 記録 | 判断 | 間隔 |
| --- | --- | --- |
| セッションの有効期限（`sessions.expires_at`） | `shouldRenew` | 残り時間が半分を切ったとき |
| API キーの最終利用（`api_keys.last_used_at`） | `shouldRecordApiKeyUse` | `API_KEY_USAGE_INTERVAL_MS`（既定 60 秒） |

判断に使う値は、認証で読む行から一緒に取ります。
判断のためだけに問い合わせを足すと、減らした往復が戻ります。

書き直す側にも条件を置きます。

```sql
UPDATE api_keys SET last_used_at = $2
 WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $3)
```

同じ時刻に届いた要求は、読んだ時点ではそろって「書くべき」と判断します。
条件があれば、実際に書き換わるのは 1 つだけになります。

## 読む量を期間に比例させる

期間を指定した検索は、期間に比例した行だけを読む。
ワークスペースの全期間を読んでから日付で捨てる形にしない。

索引の先頭は、必ず問い合わせの条件と同じ順に並べる。
`(workspace_id, employee_id, business_date)` の索引は、
従業員を指定しない問い合わせでは期間を絞れません。

### 従業員を指定しない経路

管理者が期間を指定して全体を見る経路は、従業員を条件に持ちません。
これらのために、日付を 2 番目に置いた索引を別に持ちます（マイグレーション 0023）。

| 索引 | 使う経路 |
| --- | --- |
| `attendance_events (workspace_id, business_date, employee_id)` | 異常検出（締め後の変更・修正の多発・重複打刻） |
| `attendance_calculations (workspace_id, business_date, employee_id)` | 勤怠 CSV の出力 |
| `workstation_session_observations (workspace_id, business_date, employee_id)` | PC セッション観測の一覧 |
| `daily_attendance_requests (workspace_id, business_date, employee_id)` | 申請の一覧（状態を指定しない場合） |
| `monthly_closings (workspace_id, period, employee_id)` | 締めの一覧 |
| `device_event_receipts (workspace_id, received_at)` | 異常検出（端末の時計差・連番欠落・拒否） |

3 列目の従業員は、期間で絞ったあとに従業員ごとへまとめる問い合わせのために置いています。
条件としては要りません。

従業員を先頭に置いた既存の索引は残します。
従業員を指定する経路（1 人の勤務予定、1 日の打刻、計算結果の最新版）は、
引き続きそちらを使います。片方へ寄せると、もう片方が全走査へ戻ります。

## 確かめ方

問い合わせの回数は、応答からは分かりません。
`Queryable` を差し替えて実行された SQL を記録する単体テストで固定します。

- `packages/api/src/approval/repository.test.ts`
- `packages/api/src/identity/service.test.ts`
- `packages/api/src/integration/service.test.ts`
- `packages/api/src/shared/employee-visibility.test.ts`

問い合わせの回数が入力の大きさで決まる経路では、大きさを変えて比べます。
実行された SQL を数える覆いを本物のデータベースへかぶせ、
日数を変えても増えないことを確かめます。

- `packages/api/test/integration/schedule-generation-queries.test.ts`

この形のテストは、回数そのものを主張します。
「件数を増やしても回数が変わらない」ことを確かめるため、
対象を 2 件以上にしたうえで比較します。

索引は、手元のデータ量では効果が出ません。
実行計画を毎回のテストで固定すると、量や統計の違いで結果が揺れます。
そのため、テストでは索引の有無と列の並びだけを確かめ、
効果の確認は `EXPLAIN (ANALYZE, BUFFERS)` で行って PR へ残します。

- `packages/api/test/integration/workspace-range-indexes.test.ts`
