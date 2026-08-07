import type { DailyRequestRecord, SessionResponse } from '@staffweave/contracts';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { recentBusinessDateRange } from '../session/business-date.ts';

/** 直近 3 か月分を承認対象として見る。 */
const APPROVAL_RANGE_DAYS = 90;

/**
 * 日次勤怠の確定待ち。
 *
 * 種別ごとの段階承認（`PendingApprovals`）とは別のものです。こちらは
 * 「その日の勤怠でよい」という確定で、月次を締めるための前提になります。
 * 確定していない日が残っていると、締める前の確認がそこで止まります。
 *
 * 役割が違うため、同じ一覧へ混ぜていません。混ぜると、どちらを押したのかが
 * 押した本人にも分からなくなります。
 */
export function PendingDailyRequests({
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
      .listDailyRequests({
        ...recentBusinessDateRange(session, APPROVAL_RANGE_DAYS),
        state: 'submitted',
      })
      .then((body) => setRequests(body.requests))
      .catch(() => setRequests([]));
  }, [canApprove, session]);

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
    <section className="card" aria-labelledby="daily-approvals-heading">
      <h2 id="daily-approvals-heading">{messages.dailyApprovals}</h2>
      <p className="hint">{messages.dailyApprovalsHint}</p>

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
