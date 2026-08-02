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

## 確かめ方

問い合わせの回数は、応答からは分かりません。
`Queryable` を差し替えて実行された SQL を記録する単体テストで固定します。

- `packages/api/src/approval/repository.test.ts`

この形のテストは、回数そのものを主張します。
「件数を増やしても回数が変わらない」ことを確かめるため、
対象を 2 件以上にしたうえで比較します。
