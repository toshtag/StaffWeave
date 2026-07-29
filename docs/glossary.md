# 日英用語集

日本語（仕様・UI）と英語（識別子・API・DB 名）の対応表です。
新しい概念を追加するときは、まずここへ登録してから実装します。

原則:

- 機械的な直訳をしない。英語として自然な語を選ぶ。
- DB のテーブル名は複数形スネークケース、列名は単数形スネークケース。
- API の JSON プロパティはローワーキャメルケース。
- 状態値は小文字スネークケースの英単語。

## テナントと組織

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| ワークスペース | workspace | テナント境界。すべての業務データが所属する |
| 組織 | organization | 法人・団体 |
| 拠点 | site | 事業所・現場 |
| 部門 | department | 組織内の階層 |
| 利用者 | user | 認証主体。DB テーブルは `users` |
| 従業員 | employee | 勤怠の対象者。`users` とは別概念 |
| ロール | role | 権限のまとまり |
| 所属 | membership | 利用者と Workspace の結び付き |
| セッション | session | ログイン状態 |

## 勤怠の記録

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 打刻 | punch | 動作としての打刻 |
| 打刻イベント | attendance event | 追記のみの不変レコード |
| 観測イベント | observation | 端末や PC から観測された事実 |
| 出勤 | clock in | `event_type = 'clock_in'` |
| 退勤 | clock out | `event_type = 'clock_out'` |
| 休憩開始 | break start | `event_type = 'break_start'` |
| 休憩終了 | break end | `event_type = 'break_end'` |
| 勤務日 | business date | 日跨ぎ勤務が所属する日付 |
| 打刻元 | source | `web` / `mobile` / `device` / `correction` など |
| 修正 | correction | 元イベントを残したまま追加する訂正レコード |
| 取消 | void | 打刻を無効化する訂正の種別 |
| 修正理由 | correction reason | |
| 冪等キー | request id | 二重送信防止 |

## 予定と計算

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 勤務カレンダー | work calendar | |
| 勤務パターン | work pattern | 始業・終業・休憩の型 |
| 勤務予定 | work schedule | 特定の従業員・日付への割当 |
| 所定労働時間 | scheduled work minutes | |
| 実労働時間 | worked minutes | |
| 休憩時間 | break minutes | |
| 所定内 | within schedule | |
| 所定外 | outside schedule | |
| 深夜帯 | night hours | |
| 休日 | non-working day | |
| 祝日 | public holiday | |
| 日次勤怠 | daily attendance | 一日分の確定対象レコード |
| 計算結果 | attendance calculation | |
| 入力版 | input version | 計算の入力スナップショット |
| ルール版 | rule version | 適用した計算ルールの版 |
| 計算根拠 | calculation basis | 内訳と適用ルールの記録 |

## 申請と承認

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 日次申請 | daily attendance request | |
| 申請 | request | |
| 承認 | approval | |
| 差し戻し | return | 状態値は `returned` |
| 取消 | cancel | 状態値は `cancelled` |
| コメント | comment | |
| 承認者 | approver | |
| 外部承認者 | external approver | 受入組織側の承認者 |
| 月次締め | monthly closing | |
| 締め解除 | reopen | |
| 確定 | finalize | |

## 端末と資格情報

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 打刻端末 | device | |
| 端末登録 | device enrollment | |
| 端末資格情報 | device credential | 署名鍵 |
| 署名イベント | signed event | |
| 連番 | sequence number | 端末ごとの単調増加 |
| 失効 | revoke | |
| カード資格情報 | card credential | 生識別子は保存しない |
| カード指紋 | card fingerprint | 生の識別子から作る一方向値。保存はこれのみ |
| カード登録トークン | card registration token | 一度きりの登録用トークン |
| PC セッション観測 | workstation session observation | |
| ログイン | sign in | |
| ログオフ | sign out | |
| ロック | lock | |
| ロック解除 | unlock | |

## 勤務制度

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 休暇 | leave | |
| 休暇種別 | leave type | |
| 欠勤 | absence | |
| 勤務周期 | work cycle | 曜日固定を前提にしない繰り返し単位 |
| 周期の位置 | cycle position | 周期の中の何日目か |
| 起点日 | anchor date | 周期の位置 0 に対応する業務日 |
| 有効期間 | effective period | `effective_from` / `effective_to` |

## 複数組織と契約

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 雇用元 | employer organization | |
| 受入組織 | host organization | |
| 勤務先 | workplace | 実際に勤務する拠点 |
| 契約 | assignment contract | 雇用元と受入組織の間の取り決め |
| 配属 | assignment | 従業員を勤務先へ割り当てる |
| 契約期間 | contract period | |

## 監査と連携

| 日本語 | 英語 | 備考 |
| --- | --- | --- |
| 監査記録 | audit log | |
| 乖離 | discrepancy | 打刻と観測の差 |
| 異常 | anomaly | 検出された疑わしい状態 |
| 根拠 | evidence | 異常判定の materials |
| 端末時計差 | device clock skew | |
| 連番欠落 | sequence gap | |
| 重複イベント | duplicate event | |
| 給与出力 | payroll export | |
| API キー | API key | |
| スコープ | scope | |
| 連携 | connector | |
| バックアップ | backup | |
| 復元 | restore | |
| デモモード | demo mode | |
