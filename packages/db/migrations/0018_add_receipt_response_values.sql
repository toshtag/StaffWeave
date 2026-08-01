-- 端末からの要求へ返した応答を、受領記録だけで再現できるようにする。
--
-- 受領記録には、受理した打刻の種別と、断ったときに返した理由が残っていなかった。
-- そのため再送を受け取っても最初の応答を組み立て直せず、そのときの勤務状態から
-- 種別を決め直していた。ここで加える列は、応答の再現に必要な値だけを持つ。

ALTER TABLE device_event_receipts
  -- 受理した打刻の種別。種別を指定しない要求では、最初に決めた値がここに残る。
  ADD COLUMN event_type        text,
  -- 断ったときに返した応答。再送へ同じ理由を返すために保持する。
  ADD COLUMN rejection_code    text,
  ADD COLUMN rejection_message text;

-- 0018 より前の受領記録には、応答の再現に必要な値がない。
-- 既存行へ加えた列を埋めるあいだだけ、追記のみを守るトリガーを外す。
-- 追記のみで守るのは、業務の記録がアプリケーションから書き換えられないことであり、
-- 列を増やすときの移行そのものではない。
ALTER TABLE device_event_receipts DISABLE TRIGGER device_event_receipts_append_only;

-- 受理した記録の種別は打刻イベントから補える。打刻イベントは追記のみのため、
-- 受理した記録から辿れる行は必ず残っている。
UPDATE device_event_receipts AS receipts
   SET event_type = events.event_type
  FROM attendance_events AS events
 WHERE events.id = receipts.attendance_event_id
   AND receipts.outcome <> 'rejected';

-- 断った記録の理由は detail に残した reason から補う。
-- 打刻そのものを断った記録だけは元の文言が残っていないため、種別を伴わない文言にする。
UPDATE device_event_receipts
   SET rejection_code = CASE detail->>'reason'
         WHEN 'unknown_card' THEN 'not_found'
         WHEN 'unknown_employee' THEN 'not_found'
         ELSE 'conflict'
       END,
       rejection_message = CASE detail->>'reason'
         WHEN 'unknown_card' THEN '登録されたカードが見つかりません'
         WHEN 'unknown_employee' THEN '従業員が見つかりません'
         WHEN 'sequence_replay' THEN '連番がすでに受け取った値以下です'
         ELSE 'この打刻は受け付けられません'
       END
 WHERE outcome = 'rejected';

ALTER TABLE device_event_receipts ENABLE TRIGGER device_event_receipts_append_only;

ALTER TABLE device_event_receipts
  ADD CONSTRAINT device_event_receipts_event_type_values
    CHECK (event_type IS NULL
           OR event_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  -- 受理した記録は種別を必ず持つ。応答の再現に欠かせないため、欠けた行を作らせない。
  ADD CONSTRAINT device_event_receipts_accepted_event_type
    CHECK (outcome = 'rejected' OR event_type IS NOT NULL),
  -- 断った記録は理由を必ず持ち、受理した記録は持たない。
  ADD CONSTRAINT device_event_receipts_rejection_presence
    CHECK ((outcome = 'rejected')
           = (rejection_code IS NOT NULL AND rejection_message IS NOT NULL)),
  ADD CONSTRAINT device_event_receipts_rejection_code_values
    CHECK (rejection_code IS NULL
           OR rejection_code IN ('invalid_request', 'unauthenticated', 'forbidden',
                                 'not_found', 'conflict'));
