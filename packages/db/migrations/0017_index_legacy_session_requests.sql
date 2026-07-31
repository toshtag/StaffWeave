-- 0016 より前の PC セッション観測について、冪等キーによる再送判定を支える索引。
--
-- 受領記録がまだ無い要求では、観測そのものを見て再送かどうかを判定する。
-- この照会は古い冪等キーが届いたときだけでなく、受領記録のない新しい要求すべてで走る。
-- 索引が無いと、観測が増えるほど 1 回の受け取りが重くなる。
--
-- 1 回の要求には観測が複数入るため、一意索引にはしない。

CREATE INDEX workstation_session_observations_request_idx
  ON workstation_session_observations (workspace_id, request_id);
