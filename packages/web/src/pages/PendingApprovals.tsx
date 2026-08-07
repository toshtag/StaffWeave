import type {
  EmployeeRequestRecord,
  RequestTypeRecord,
  SessionResponse,
} from '@staffweave/contracts';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { recentBusinessDateRange } from '../session/business-date.ts';

/** 直近 3 か月分を承認対象として見る。 */
const APPROVAL_RANGE_DAYS = 90;

/**
 * 決裁を待っている申請。
 *
 * 出すのは、いまの段が自分の番のものだけです。全部を出すと、押しても断られる
 * 申請が混ざり、列として使えません。判断はサーバーが段ごとの承認者で行い、
 * 画面はその結果を並べます。
 *
 * 決裁は段と提出回数を添えて送ります。添えないと、古い画面から送り直した
 * 決裁が次の段へ進めてしまいます。
 */
export function PendingApprovals({
  session,
}: {
  session: SessionResponse;
}): React.JSX.Element | null {
  const { messages } = useLocale();
  const labels = messages.requests;
  const [requests, setRequests] = useState<EmployeeRequestRecord[] | null>(null);
  const [types, setTypes] = useState<RequestTypeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState<{ id: string; reason: string } | null>(null);
  const reasonId = useId();

  const canApprove = session.user.permissions.includes('attendance.approve');

  const load = useCallback(() => {
    if (!canApprove) return;
    api
      .listEmployeeRequests({
        ...recentBusinessDateRange(session, APPROVAL_RANGE_DAYS),
        state: 'submitted',
        // いまの段が自分の番のものだけを出す。全部を出すと、押しても断られる
        // 申請が混ざり、列として使えない。
        awaitingMe: 'true',
      })
      .then((body) => setRequests(body.requests))
      .catch(() => setRequests([]));
  }, [canApprove, session]);

  useEffect(() => {
    if (!canApprove) return;
    api
      .listRequestTypes()
      .then((body) => setTypes(body.requestTypes))
      .catch(() => setTypes([]));
  }, [canApprove]);

  useEffect(load, [load]);

  if (!canApprove) return null;

  const nameOfType = (id: string): string =>
    types.find((candidate) => candidate.id === id)?.name ?? id;

  function decide(
    request: EmployeeRequestRecord,
    decision: 'approved' | 'returned',
    comment?: string,
  ): void {
    setError(null);
    api
      // 段と提出回数を添える。添えないと、古い画面から送り直した決裁が
      // 次の段へ進めてしまう。
      .decideEmployeeRequest(request.id, {
        decision,
        step: request.currentStep,
        submission: request.submissions,
        ...(comment === undefined ? {} : { comment }),
      })
      .then(() => {
        setReturning(null);
        load();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
      });
  }

  return (
    <section className="card">
      <h2>{messages.approvals}</h2>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {requests === null && <p>{messages.loading}</p>}
      {requests !== null && requests.length === 0 && <p>{messages.noPendingRequests}</p>}

      {requests !== null && requests.length > 0 && (
        <ul className="approval-list">
          {requests.map((request) => (
            <li key={request.id}>
              <span>{request.businessDate}</span>
              <span>{nameOfType(request.requestTypeId)}</span>
              <span>
                {labels.progress(request.currentStep, request.totalSteps, request.submissions)}
              </span>
              <span className="punch-actions">
                <button type="button" onClick={() => decide(request, 'approved')}>
                  {messages.approve}
                </button>
                <button type="button" onClick={() => setReturning({ id: request.id, reason: '' })}>
                  {messages.returnRequest}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {returning !== null && (
        <form
          className="correction-form"
          onSubmit={(event) => {
            event.preventDefault();
            const target = requests?.find((request) => request.id === returning.id);
            if (target !== undefined) decide(target, 'returned', returning.reason);
          }}
        >
          <div className="field">
            <label htmlFor={reasonId}>{messages.returnReason}</label>
            <input
              id={reasonId}
              type="text"
              required
              minLength={1}
              value={returning.reason}
              onChange={(event) => setReturning({ ...returning, reason: event.target.value })}
            />
          </div>
          <div className="form-actions">
            <button type="submit">{messages.returnRequest}</button>
            <button type="button" onClick={() => setReturning(null)}>
              {messages.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
