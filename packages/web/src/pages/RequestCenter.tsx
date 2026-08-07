import type {
  EmployeeRequestRecord,
  LeaveTypeRecord,
  RequestTypeRecord,
  SessionResponse,
} from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { recentBusinessDateRange } from '../session/business-date.ts';

/** 自分の申請として見る範囲。締めの前後を見渡せる長さにする。 */
const HISTORY_DAYS = 90;

/**
 * 従業員の申請センター。
 *
 * 申請種別の設定に応じて入力を出し分けます。理由・休暇種別・時間帯・
 * 残業の上限は、種別が要ると言ったものだけを出します。要らない項目を
 * 並べると、何を書けばよいのかが読み取れません。
 *
 * 出した申請の状態・決裁の履歴・取消・差し戻し後の出し直しも、ここで扱います。
 * 承認の側は `PendingApprovals` にあり、役割を分けています。
 */
export function RequestCenter({ session }: { session: SessionResponse }): React.JSX.Element | null {
  const { messages } = useLocale();
  const labels = messages.requests;

  const [types, setTypes] = useState<RequestTypeRecord[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRecord[]>([]);
  const [requests, setRequests] = useState<EmployeeRequestRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [typeId, setTypeId] = useState('');
  const [businessDate, setBusinessDate] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startMinutes, setStartMinutes] = useState('');
  const [endMinutes, setEndMinutes] = useState('');
  const [overtimeLimitMinutes, setOvertimeLimitMinutes] = useState('');
  const [reason, setReason] = useState('');

  const employeeId = session.employee?.id ?? null;

  const load = useCallback(() => {
    if (employeeId === null) return;
    const range = recentBusinessDateRange(session, HISTORY_DAYS);
    api
      .listEmployeeRequests({ employeeId, ...range })
      .then((body) => setRequests(body.requests))
      .catch(() => setRequests([]));
  }, [employeeId, session]);

  useEffect(() => {
    if (employeeId === null) return;
    api
      .listRequestTypes()
      .then((body) => {
        const active = body.requestTypes.filter((type) => type.active);
        setTypes(active);
        setTypeId((current) => current || (active[0]?.id ?? ''));
      })
      .catch(() => setTypes([]));
    api
      .listLeaveTypes()
      .then((body) => {
        setLeaveTypes(body.leaveTypes);
        setLeaveTypeId((current) => current || (body.leaveTypes[0]?.id ?? ''));
      })
      .catch(() => setLeaveTypes([]));
  }, [employeeId]);

  useEffect(load, [load]);

  // 従業員に紐づいていない利用者は、自分の申請を持たない。
  if (employeeId === null) return null;
  const submitterId = employeeId;

  const type = types.find((candidate) => candidate.id === typeId) ?? null;
  const nameOfType = (id: string): string =>
    types.find((candidate) => candidate.id === id)?.name ?? id;

  function run(action: () => Promise<unknown>, done: string): void {
    setError(null);
    setNotice(null);
    action()
      .then(() => {
        setNotice(done);
        load();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
      });
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (type === null) return;
    const number = (text: string): number | undefined =>
      text.trim() === '' ? undefined : Number(text);
    run(
      () =>
        api.submitEmployeeRequest({
          requestTypeId: type.id,
          employeeId: submitterId,
          businessDate,
          ...(endsOn === '' ? {} : { endsOn }),
          ...(type.requiresLeaveType && leaveTypeId !== '' ? { leaveTypeId } : {}),
          ...(type.requiresTimeRange
            ? { startMinutes: number(startMinutes), endMinutes: number(endMinutes) }
            : {}),
          ...(type.requiresOvertimeLimit
            ? { overtimeLimitMinutes: number(overtimeLimitMinutes) }
            : {}),
          ...(reason.trim() === '' ? {} : { reason }),
        }),
      labels.submitted,
    );
  }

  return (
    <section className="card" aria-labelledby="request-center-heading">
      <h2 id="request-center-heading">{labels.title}</h2>
      <p className="hint">{labels.hint}</p>

      <form onSubmit={submit}>
        <label htmlFor="request-type">{labels.requestType}</label>
        <select
          id="request-type"
          value={typeId}
          onChange={(event) => setTypeId(event.target.value)}
        >
          {types.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>

        <label htmlFor="request-business-date">{labels.businessDate}</label>
        <input
          id="request-business-date"
          type="date"
          value={businessDate}
          onChange={(event) => setBusinessDate(event.target.value)}
          required
        />

        <label htmlFor="request-ends-on">{labels.endsOn}</label>
        <input
          id="request-ends-on"
          type="date"
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
        />

        {type?.requiresLeaveType === true && (
          <>
            <label htmlFor="request-leave-type">{labels.leaveType}</label>
            <select
              id="request-leave-type"
              value={leaveTypeId}
              onChange={(event) => setLeaveTypeId(event.target.value)}
            >
              {leaveTypes.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </>
        )}

        {type?.requiresTimeRange === true && (
          <>
            <label htmlFor="request-start-minutes">{labels.startMinutes}</label>
            <input
              id="request-start-minutes"
              type="number"
              min={0}
              max={2878}
              value={startMinutes}
              onChange={(event) => setStartMinutes(event.target.value)}
              required
            />
            <label htmlFor="request-end-minutes">{labels.endMinutes}</label>
            <input
              id="request-end-minutes"
              type="number"
              min={1}
              max={2879}
              value={endMinutes}
              onChange={(event) => setEndMinutes(event.target.value)}
              required
            />
          </>
        )}

        {type?.requiresOvertimeLimit === true && (
          <>
            <label htmlFor="request-overtime-limit">{labels.overtimeLimit}</label>
            <input
              id="request-overtime-limit"
              type="number"
              min={0}
              max={2879}
              value={overtimeLimitMinutes}
              onChange={(event) => setOvertimeLimitMinutes(event.target.value)}
              required
            />
          </>
        )}

        {type?.requiresReason === true && (
          <>
            <label htmlFor="request-reason">{labels.reason}</label>
            <textarea
              id="request-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </>
        )}

        <button type="submit">{labels.submit}</button>
      </form>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && <p role="status">{notice}</p>}

      <h3>{labels.myRequests}</h3>
      {requests.length === 0 ? (
        <p>{labels.noRequests}</p>
      ) : (
        <ul className="request-list">
          {requests.map((record) => (
            <li key={record.id}>
              <span>{record.businessDate}</span>
              <span>{nameOfType(record.requestTypeId)}</span>
              <span>{labels.stateLabel[record.state]}</span>
              <span>
                {labels.progress(record.currentStep, record.totalSteps, record.submissions)}
              </span>
              {record.state === 'submitted' && (
                <button
                  type="button"
                  onClick={() => run(() => api.cancelEmployeeRequest(record.id), labels.cancelled)}
                >
                  {labels.cancel}
                </button>
              )}
              {record.state === 'returned' && (
                <button
                  type="button"
                  onClick={() =>
                    run(() => api.resubmitEmployeeRequest(record.id, {}), labels.resubmitted)
                  }
                >
                  {labels.resubmit}
                </button>
              )}
              {record.approvals.length > 0 && (
                <ul>
                  {record.approvals.map((approval) => (
                    <li key={approval.id}>
                      {labels.decisionLine(
                        approval.step,
                        approval.submission,
                        labels.decisionLabel[approval.decision],
                      )}
                      {approval.comment === null ? '' : ` / ${approval.comment}`}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
