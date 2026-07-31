import type {
  AttendanceEventRecord,
  EmployeeSummary,
  SessionResponse,
  WorkDay,
} from '@staffweave/contracts';
import type {
  AttendanceEventType,
  CorrectionAction,
  DailyRequestState,
  WorkDayState,
} from '@staffweave/domain';
import { summarizeWorkDay } from '@staffweave/domain';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import type { Messages } from '../i18n/messages.ts';
import type { PunchBlockedReason, PunchQueue, PunchQueueSnapshot } from '../offline/punch-queue.ts';
import { createPunchQueue } from '../offline/punch-queue.ts';
import { useSession } from '../session/SessionProvider.tsx';

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

function blockedLabel(reason: PunchBlockedReason, messages: Messages): string {
  switch (reason) {
    case 'authentication_required':
      return messages.punchBlockedAuthentication;
    case 'permission_blocked':
      return messages.punchBlockedPermission;
    case 'retry_later':
      return messages.punchBlockedRetry;
  }
}

function requestStateLabel(state: DailyRequestState, messages: Messages): string {
  switch (state) {
    case 'draft':
      return messages.requestDraft;
    case 'submitted':
      return messages.requestSubmitted;
    case 'approved':
      return messages.requestApproved;
    case 'returned':
      return messages.requestReturned;
    case 'cancelled':
      return messages.requestCancelled;
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
 *
 * 打刻は従業員に対して記録するため、従業員が紐づいていない利用者には案内だけを出す。
 * 送信待ち行列は従業員が確定してから作り、代わりの識別子で保存先を作らない。
 */
export function TodayAttendance({ session }: { session: SessionResponse }): React.JSX.Element {
  const { messages } = useLocale();
  const { employee } = session;

  if (employee === null) {
    return (
      <section className="card">
        <h2>{messages.today}</h2>
        <p>{messages.employeeRequiredForPunch}</p>
      </section>
    );
  }

  return <EmployeeTodayAttendance session={session} employee={employee} />;
}

/**
 * 従業員が確定している場合の本日の勤怠。
 *
 * 携帯電話で片手で使えることを最優先にする。
 * 現在の状態と「次に押すべきボタン」を画面の上へ大きく出し、修正や履歴はその下に置く。
 * 通信できないときも打刻は受け付け、送信待ちとして見せてから後で送る。
 */
function EmployeeTodayAttendance({
  session,
  employee,
}: {
  session: SessionResponse;
  employee: EmployeeSummary;
}): React.JSX.Element {
  const { locale, messages } = useLocale();
  const { markSessionExpired } = useSession();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [snapshot, setSnapshot] = useState<PunchQueueSnapshot>(() => ({
    pending: [],
    blocked: null,
    hasLegacyEntries: false,
    hasUnreadableEntries: false,
  }));
  const [online, setOnline] = useState(() => window.navigator.onLine);
  const reasonId = useId();
  const timeId = useId();
  const typeId = useId();

  const [queue, setQueue] = useState<PunchQueue | null>(null);
  const workspaceId = session.workspace.id;
  const userId = session.user.id;
  const employeeId = employee.id;

  // 勤務日の版。読み込みの応答が、その後に確定した勤務日を上書きしないようにする。
  const dayVersion = useRef(0);

  /**
   * 更新系の応答で確定した勤務日を反映する。
   * これより前に始めた読み込みは、以後どれも反映しない。
   */
  const applyCurrentDay = useCallback((day: WorkDay): void => {
    dayVersion.current += 1;
    setState({ status: 'ready', day });
  }, []);

  /**
   * 現在の勤務日を読み直す。
   * 読み込んでいる間に打刻や修正が確定した場合、古い応答で画面を巻き戻さない。
   */
  const readCurrentDay = useCallback(
    (handlers: { onDay: (day: WorkDay) => void; onFailure: (cause: unknown) => void }) => {
      dayVersion.current += 1;
      const version = dayVersion.current;
      return api.getTodayAttendance().then(
        (day) => {
          if (version === dayVersion.current) handlers.onDay(day);
        },
        (cause: unknown) => {
          if (version === dayVersion.current) handlers.onFailure(cause);
        },
      );
    },
    [],
  );

  const load = useCallback(() => {
    void readCurrentDay({
      onDay: (day) => setState({ status: 'ready', day }),
      // 勤務日を取得できない間は、打刻の操作を出さない。
      onFailure: () => setState({ status: 'unavailable' }),
    });
  }, [readCurrentDay]);

  useEffect(load, [load]);

  // 行列の寿命はこの画面と同じにする。
  // 利用者・Workspace・従業員のいずれかが変われば、前の行列を破棄して別の行列を作る。
  useEffect(() => {
    const created = createPunchQueue({
      owner: { workspaceId, userId, employeeId },
      onAccepted: (result) => applyCurrentDay(result.day),
      onRejected: (_entry, message) => setError(message),
      onAuthenticationRequired: () => markSessionExpired('pending_punches'),
    });
    const unsubscribe = created.subscribe(setSnapshot);
    setQueue(created);

    return () => {
      unsubscribe();
      created.dispose();
      setQueue(null);
      setSnapshot({
        pending: [],
        blocked: null,
        hasLegacyEntries: false,
        hasUnreadableEntries: false,
      });
    };
  }, [workspaceId, userId, employeeId, markSessionExpired, applyCurrentDay]);

  // 認証が切れて残った打刻は online が起きないため、画面を開いた時点で送り直す。
  // 送るのは勤務日を読み込んだ後にする。
  // 先に送ると、送信前に始めた読み込みが後から届き、送れた打刻を消してしまう。
  useEffect(() => {
    if (queue === null || state.status === 'loading') return;
    void queue.flush();
  }, [queue, state.status]);

  useEffect(() => {
    const update = (): void => setOnline(window.navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (state.status === 'unavailable') {
    return (
      <section className="card">
        <h2>{messages.today}</h2>
        <p>{messages.networkError}</p>
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

  // 送信待ちの打刻も含めて、利用者から見た「今の状態」を組み立てる。
  const displayState = summarizeWorkDay(day.businessDate, [
    ...day.events.map((event) => ({
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
    })),
    ...snapshot.pending.map((entry) => ({
      eventType: entry.eventType,
      occurredAt: new Date(entry.occurredAt),
    })),
  ]).state;

  function handle(promise: Promise<{ day: WorkDay }>): void {
    setSubmitting(true);
    setError(null);
    promise
      .then((result) => {
        applyCurrentDay(result.day);
        setDraft(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.punchFailed);
        load();
      })
      .finally(() => setSubmitting(false));
  }

  function punch(eventType: AttendanceEventType): void {
    if (queue === null) return;
    setError(null);
    void queue.enqueue(eventType, new Date());
  }

  function reload(): void {
    setSubmitting(true);
    setError(null);
    void readCurrentDay({
      onDay: (next) => setState({ status: 'ready', day: next }),
      onFailure: (cause) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
      },
    }).finally(() => setSubmitting(false));
  }

  function submitRequest(): void {
    setSubmitting(true);
    setError(null);
    api
      .submitDailyRequest({ businessDate: day.businessDate })
      .then(reload)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
        setSubmitting(false);
      });
  }

  function cancelRequest(): void {
    const requestId = day.request?.id;
    if (requestId === undefined) return;
    setSubmitting(true);
    setError(null);
    api
      .decideDailyRequest(requestId, 'cancel', {})
      .then(reload)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
        setSubmitting(false);
      });
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
    displayState === 'not_started' ? 'clock_in' : displayState === 'working' ? 'clock_out' : null;
  const secondary: AttendanceEventType | null =
    displayState === 'working' ? 'break_start' : displayState === 'on_break' ? 'break_end' : null;
  const punchDisabled = !day.editable;

  return (
    <section className="card punch-card">
      <h2>{messages.today}</h2>

      <p className="work-state" data-state={displayState} aria-live="polite">
        {stateLabel(displayState, messages)}
      </p>

      {!online && (
        <p className="offline-banner" role="status">
          {messages.offlineNotice}
        </p>
      )}

      {snapshot.pending.length > 0 && (
        <p className="pending-banner" role="status">
          {messages.pendingPunches(snapshot.pending.length)}
        </p>
      )}

      {snapshot.blocked !== null && (
        <p className="blocked-banner" role="status">
          {blockedLabel(snapshot.blocked.reason, messages)}
        </p>
      )}

      {snapshot.hasUnreadableEntries && (
        <p className="legacy-banner" role="status">
          {messages.unreadablePendingPunches}
        </p>
      )}

      {snapshot.hasLegacyEntries && (
        <p className="legacy-banner" role="status">
          {messages.legacyPendingPunches}
        </p>
      )}

      {online && snapshot.pending.length > 0 && (
        <button
          type="button"
          className="retry-button"
          onClick={() => {
            setError(null);
            void queue?.flush();
          }}
        >
          {messages.retryPendingPunches}
        </button>
      )}

      {punchDisabled && <p className="notice">{messages.editingLocked}</p>}

      {!punchDisabled && primary !== null && (
        <button
          type="button"
          className="punch-button"
          data-event-type={primary}
          onClick={() => punch(primary)}
        >
          {eventLabel(primary, messages)}
        </button>
      )}

      {!punchDisabled && secondary !== null && (
        <button
          type="button"
          className="break-button"
          data-event-type={secondary}
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

      <h3>{messages.calculation}</h3>
      {day.calculation === null ? (
        <p className="notice">{messages.calculationPending}</p>
      ) : (
        <>
          {day.calculation.basis.incomplete && (
            <p className="notice">{messages.calculationIncomplete}</p>
          )}
          <dl className="details calculation-details">
            <dt>{messages.workedTime}</dt>
            <dd>{messages.formatDuration(day.calculation.workedMinutes)}</dd>
            <dt>{messages.breakTime}</dt>
            <dd>{messages.formatDuration(day.calculation.breakMinutes)}</dd>
            <dt>{messages.scheduledTime}</dt>
            <dd>{messages.formatDuration(day.calculation.scheduledMinutes)}</dd>
            <dt>{messages.outsideScheduleTime}</dt>
            <dd>{messages.formatDuration(day.calculation.outsideScheduleMinutes)}</dd>
            <dt>{messages.nightTime}</dt>
            <dd>{messages.formatDuration(day.calculation.nightMinutes)}</dd>
            <dt>{messages.nonWorkingDayTime}</dt>
            <dd>{messages.formatDuration(day.calculation.nonWorkingDayMinutes)}</dd>
          </dl>
          <p className="notice">
            {messages.calculationVersion}: {day.calculation.version} / {day.calculation.ruleVersion}
          </p>
        </>
      )}

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

      <h3>{messages.request}</h3>
      <p className="request-state" data-state={day.request?.state ?? 'draft'}>
        {day.request === null
          ? messages.notRequestedYet
          : requestStateLabel(day.request.state, messages)}
      </p>
      {(day.request === null ||
        day.request.state === 'returned' ||
        day.request.state === 'cancelled') && (
        <button type="button" disabled={submitting} onClick={submitRequest}>
          {messages.submitRequest}
        </button>
      )}
      {day.request?.state === 'submitted' && (
        <button type="button" disabled={submitting} onClick={cancelRequest}>
          {messages.cancelRequest}
        </button>
      )}
      {day.request !== null && day.request.transitions.length > 0 && (
        <details className="record-history">
          <summary>{messages.requestHistory}</summary>
          <ul className="history-list">
            {day.request.transitions.map((transition) => (
              <li key={transition.occurredAt}>
                <span>
                  {requestStateLabel(transition.fromState, messages)} →{' '}
                  {requestStateLabel(transition.toState, messages)}
                </span>
                <time dateTime={transition.occurredAt}>
                  {new Date(transition.occurredAt).toLocaleString(locale)}
                </time>
                {transition.comment !== null && (
                  <span className="history-reason">{transition.comment}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
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
              {day.editable && (
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
              )}
            </li>
          ))}
        </ul>
      )}

      {day.editable && (
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
      )}

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
                    setDraft({ ...draft, eventType: event.target.value as AttendanceEventType })
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

      <details className="record-history">
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
        {employee.employeeNumber} / {day.businessDate}
      </p>
    </section>
  );
}
