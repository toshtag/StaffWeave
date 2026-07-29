import type { AttendanceEventRecord, SessionResponse, WorkDay } from '@staffweave/contracts';
import type { AttendanceEventType, CorrectionAction, WorkDayState } from '@staffweave/domain';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import type { Messages } from '../i18n/messages.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; day: WorkDay }
  | { status: 'unavailable' };

function stateLabel(state: WorkDayState, messages: Messages): string {
  switch (state) {
    case 'not_started':
      return messages.stateNotStarted;
    case 'working':
      return messages.stateWorking;
    case 'on_break':
      return messages.stateOnBreak;
    case 'finished':
      return messages.stateFinished;
  }
}

function eventLabel(eventType: AttendanceEventType, messages: Messages): string {
  switch (eventType) {
    case 'clock_in':
      return messages.clockIn;
    case 'clock_out':
      return messages.clockOut;
    case 'break_start':
      return messages.breakStart;
    case 'break_end':
      return messages.breakEnd;
  }
}

function actionLabel(action: CorrectionAction, messages: Messages): string {
  switch (action) {
    case 'adjust':
      return messages.actionAdjust;
    case 'void':
      return messages.actionVoid;
    case 'add':
      return messages.actionAdd;
  }
}

function formatTime(value: string | null, locale: string): string {
  if (value === null) return '—';
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** `datetime-local` 入力に渡すため、現地時間の文字列へ変換する。 */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

interface CorrectionDraft {
  action: CorrectionAction;
  target: AttendanceEventRecord | null;
  eventType: AttendanceEventType;
  occurredAt: string;
  reason: string;
}

/**
 * 本日の勤怠。
 * 従業員が迷わないよう、現在の状態と「次に押すべきボタン」を大きく出し、
 * 修正はそのあとに置く。
 */
export function TodayAttendance({ session }: { session: SessionResponse }): React.JSX.Element {
  const { locale, messages } = useLocale();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const reasonId = useId();
  const timeId = useId();
  const typeId = useId();

  const load = useCallback(() => {
    api
      .getTodayAttendance()
      .then((day) => setState({ status: 'ready', day }))
      // 従業員が紐づいていない場合も通信に失敗した場合も、打刻できないことに変わりはない。
      .catch(() => setState({ status: 'unavailable' }));
  }, []);

  useEffect(load, [load]);

  if (state.status === 'unavailable') {
    return (
      <section className="card">
        <h2>{messages.today}</h2>
        <p>{messages.employeeRequiredForPunch}</p>
      </section>
    );
  }

  if (state.status === 'loading') {
    return (
      <section className="card">
        <h2>{messages.today}</h2>
        <p>{messages.loading}</p>
      </section>
    );
  }

  const { day } = state;

  function handle(promise: Promise<{ day: WorkDay }>): void {
    setSubmitting(true);
    setError(null);
    promise
      .then((result) => {
        setState({ status: 'ready', day: result.day });
        setDraft(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.punchFailed);
        load();
      })
      .finally(() => setSubmitting(false));
  }

  function punch(eventType: AttendanceEventType): void {
    handle(api.recordAttendanceEvent({ eventType, requestId: crypto.randomUUID() }));
  }

  function submitCorrection(current: CorrectionDraft): void {
    handle(
      api.correctAttendance({
        action: current.action,
        ...(current.target === null ? {} : { targetEventId: current.target.id }),
        ...(current.action === 'void'
          ? {}
          : {
              eventType: current.eventType,
              occurredAt: new Date(current.occurredAt).toISOString(),
            }),
        ...(current.action === 'add' ? { businessDate: day.businessDate } : {}),
        reason: current.reason,
        requestId: crypto.randomUUID(),
      }),
    );
  }

  const primary: AttendanceEventType | null =
    day.state === 'not_started' ? 'clock_in' : day.state === 'working' ? 'clock_out' : null;
  const secondary: AttendanceEventType | null =
    day.state === 'working' ? 'break_start' : day.state === 'on_break' ? 'break_end' : null;

  return (
    <section className="card">
      <h2>{messages.today}</h2>
      <p className="work-state" data-state={day.state}>
        {stateLabel(day.state, messages)}
      </p>

      {primary !== null && (
        <button
          type="button"
          className="punch-button"
          data-event-type={primary}
          disabled={submitting}
          onClick={() => punch(primary)}
        >
          {eventLabel(primary, messages)}
        </button>
      )}

      {secondary !== null && (
        <button
          type="button"
          className="break-button"
          data-event-type={secondary}
          disabled={submitting}
          onClick={() => punch(secondary)}
        >
          {eventLabel(secondary, messages)}
        </button>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <dl className="details">
        <dt>{messages.firstClockInAt}</dt>
        <dd>{formatTime(day.firstClockInAt, locale)}</dd>
        <dt>{messages.lastClockOutAt}</dt>
        <dd>{formatTime(day.lastClockOutAt, locale)}</dd>
      </dl>

      {day.breaks.length > 0 && (
        <>
          <h3>{messages.breaks}</h3>
          <ul className="break-list">
            {day.breaks.map((period) => (
              <li key={period.startedAt}>
                <span>{formatTime(period.startedAt, locale)}</span>
                <span>
                  {period.endedAt === null
                    ? messages.breakInProgress
                    : formatTime(period.endedAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>{messages.punchHistory}</h3>
      {day.events.length === 0 ? (
        <p>{messages.noPunchYet}</p>
      ) : (
        <ul className="punch-list punch-events">
          {day.events.map((event) => (
            <li key={event.id}>
              <span>{eventLabel(event.eventType, messages)}</span>
              <time dateTime={event.occurredAt}>{formatTime(event.occurredAt, locale)}</time>
              <span className="punch-actions">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setDraft({
                      action: 'adjust',
                      target: event,
                      eventType: event.eventType,
                      occurredAt: toLocalInputValue(event.occurredAt),
                      reason: '',
                    })
                  }
                >
                  {messages.correct}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setDraft({
                      action: 'void',
                      target: event,
                      eventType: event.eventType,
                      occurredAt: toLocalInputValue(event.occurredAt),
                      reason: '',
                    })
                  }
                >
                  {messages.voidPunch}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="add-punch-button"
        disabled={submitting}
        onClick={() =>
          setDraft({
            action: 'add',
            target: null,
            eventType: 'clock_in',
            occurredAt: toLocalInputValue(new Date().toISOString()),
            reason: '',
          })
        }
      >
        {messages.addPunch}
      </button>

      {draft !== null && (
        <form
          className="correction-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitCorrection(draft);
          }}
        >
          <h3>{actionLabel(draft.action, messages)}</h3>

          {draft.target !== null && (
            <p className="notice">
              {messages.originalPunch}: {eventLabel(draft.target.eventType, messages)}{' '}
              {formatTime(draft.target.occurredAt, locale)}
            </p>
          )}

          {draft.action !== 'void' && (
            <>
              <div className="field">
                <label htmlFor={typeId}>{messages.correctionType}</label>
                <select
                  id={typeId}
                  value={draft.eventType}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      eventType: event.target.value as AttendanceEventType,
                    })
                  }
                >
                  <option value="clock_in">{messages.clockIn}</option>
                  <option value="clock_out">{messages.clockOut}</option>
                  <option value="break_start">{messages.breakStart}</option>
                  <option value="break_end">{messages.breakEnd}</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor={timeId}>{messages.correctionTime}</label>
                <input
                  id={timeId}
                  type="datetime-local"
                  required
                  value={draft.occurredAt}
                  onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })}
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor={reasonId}>{messages.correctionReason}</label>
            <input
              id={reasonId}
              type="text"
              required
              minLength={2}
              maxLength={500}
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={submitting}>
              {messages.save}
            </button>
            <button type="button" disabled={submitting} onClick={() => setDraft(null)}>
              {messages.cancel}
            </button>
          </div>
        </form>
      )}

      <details
        className="record-history"
        open={historyOpen}
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary>{messages.recordHistory}</summary>
        <ul className="history-list">
          {day.history.map((record) => (
            <li key={record.id}>
              <span>
                {record.correctionAction === null
                  ? eventLabel(record.eventType, messages)
                  : `${actionLabel(record.correctionAction, messages)}: ${eventLabel(record.eventType, messages)}`}
              </span>
              <time dateTime={record.occurredAt}>{formatTime(record.occurredAt, locale)}</time>
              {record.correctionReason !== null && (
                <span className="history-reason">{record.correctionReason}</span>
              )}
            </li>
          ))}
        </ul>
      </details>

      <p className="notice">
        {session.employee?.employeeNumber} / {day.businessDate}
      </p>
    </section>
  );
}
