import type { SessionResponse, WorkDay } from '@staffweave/contracts';
import type { AttendanceEventType, WorkDayState } from '@staffweave/domain';
import { useCallback, useEffect, useState } from 'react';
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
    case 'finished':
      return messages.stateFinished;
  }
}

function formatTime(value: string | null, locale: string): string {
  if (value === null) return '—';
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * 本日の勤怠。
 * 従業員が迷わないよう、現在の状態と「次に押すべきボタン」だけを大きく出す。
 */
export function TodayAttendance({ session }: { session: SessionResponse }): React.JSX.Element {
  const { locale, messages } = useLocale();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  const nextEventType: AttendanceEventType | null =
    day.state === 'not_started' ? 'clock_in' : day.state === 'working' ? 'clock_out' : null;

  function punch(eventType: AttendanceEventType): void {
    setSubmitting(true);
    setError(null);
    api
      .recordAttendanceEvent({ eventType, requestId: crypto.randomUUID() })
      .then((result) => setState({ status: 'ready', day: result.day }))
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.punchFailed);
        load();
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <section className="card">
      <h2>{messages.today}</h2>
      <p className="work-state" data-state={day.state}>
        {stateLabel(day.state, messages)}
      </p>

      {nextEventType !== null && (
        <button
          type="button"
          className="punch-button"
          data-event-type={nextEventType}
          disabled={submitting}
          onClick={() => punch(nextEventType)}
        >
          {nextEventType === 'clock_in' ? messages.clockIn : messages.clockOut}
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

      <h3>{messages.punchHistory}</h3>
      {day.events.length === 0 ? (
        <p>{messages.noPunchYet}</p>
      ) : (
        <ul className="punch-list">
          {day.events.map((event) => (
            <li key={event.id}>
              <span>{event.eventType === 'clock_in' ? messages.clockIn : messages.clockOut}</span>
              <time dateTime={event.occurredAt}>{formatTime(event.occurredAt, locale)}</time>
            </li>
          ))}
        </ul>
      )}

      <p className="notice">
        {session.employee?.employeeNumber} / {day.businessDate}
      </p>
    </section>
  );
}
