import type { DailyRequestRecord, SessionResponse } from '@staffweave/contracts';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/** 直近 3 か月分を承認対象として見る。 */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

/**
 * 承認待ちの申請。
 * 承認権限を持つ利用者にだけ表示する。
 */
export function PendingApprovals({
  session,
}: {
  session: SessionResponse;
}): React.JSX.Element | null {
  const { messages } = useLocale();
  const [requests, setRequests] = useState<DailyRequestRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState<{ id: string; reason: string } | null>(null);
  const reasonId = useId();

  const canApprove = session.user.permissions.includes('attendance.approve');

  const load = useCallback(() => {
    if (!canApprove) return;
    api
      .listDailyRequests({ ...defaultRange(), state: 'submitted' })
      .then((body) => setRequests(body.requests))
      .catch(() => setRequests([]));
  }, [canApprove]);

  useEffect(load, [load]);

  if (!canApprove) return null;

  function decide(requestId: string, decision: 'approve' | 'return', comment?: string): void {
    setError(null);
    api
      .decideDailyRequest(requestId, decision, comment === undefined ? {} : { comment })
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
              <span className="punch-actions">
                <button type="button" onClick={() => decide(request.id, 'approve')}>
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
            decide(returning.id, 'return', returning.reason);
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
