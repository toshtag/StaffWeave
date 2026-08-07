import type { AttendanceDaySummary, SessionResponse, WorkDay } from '@staffweave/contracts';
import { addMonthsToBusinessDate } from '@staffweave/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { businessToday } from '../session/business-date.ts';
import { formatInstantInTimeZone } from '../time/zoned.ts';

/**
 * 過去の日次勤怠。
 *
 * これまで通常の画面は当日しか出せず、昨日以前を選ぶ導線がありませんでした。
 * API には 1 日を読む経路も過去の訂正もあるのに、利用者はそこへ辿り着けません。
 *
 * 月を選び、日を選び、その日の詳細へ進む形にします。編集できるかどうかは
 * サーバーが返す値をそのまま使います。画面で判断し直すと、締めや申請の状態に
 * ついて API と別の答えを出しかねません。
 *
 * 時刻は拠点の時間帯で出します。閲覧者の端末の時計では出しません。
 */
export function AttendanceHistory({
  session,
}: {
  session: SessionResponse;
}): React.JSX.Element | null {
  const { locale, messages } = useLocale();
  const labels = messages.history;

  const [period, setPeriod] = useState(() => `${businessToday(session).slice(0, 7)}-01`);
  const [days, setDays] = useState<AttendanceDaySummary[] | null>(null);
  const [selected, setSelected] = useState<WorkDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const employeeId = session.employee?.id ?? null;
  const timeZone = session.workspace.timeZone;

  // 読み直しは、前の読み出しが返る前にも起こる。返った順に書き込むと、
  // 古い結果が新しい結果を上書きし、打刻したはずの日が消えて見える。
  const latestRequest = useRef(0);

  const load = useCallback(() => {
    if (employeeId === null) return;
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setError(null);
    api
      .listAttendanceDays({ period })
      .then((body) => {
        if (latestRequest.current !== request) return;
        setDays(body.days);
      })
      .catch((cause: unknown) => {
        if (latestRequest.current !== request) return;
        setDays([]);
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
      });
  }, [employeeId, messages.networkError, period]);

  useEffect(load, [load]);

  // 従業員に紐づいていない利用者は、自分の勤怠を持たない。
  if (employeeId === null) return null;

  function shift(months: number): void {
    setSelected(null);
    setPeriod((current) => addMonthsToBusinessDate(current, months));
  }

  function open(businessDate: string): void {
    setError(null);
    api
      .getAttendanceDay(businessDate)
      .then(setSelected)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiRequestError ? cause.message : messages.networkError);
      });
  }

  const clock = (iso: string | null): string =>
    iso === null ? '—' : formatInstantInTimeZone(iso, timeZone, locale);

  return (
    <section className="card" aria-labelledby="attendance-history-heading">
      <h2 id="attendance-history-heading">{labels.title}</h2>
      <p className="hint">{labels.hint}</p>

      <div className="punch-actions">
        <button type="button" onClick={() => shift(-1)}>
          {labels.previousMonth}
        </button>
        <span aria-live="polite">{period.slice(0, 7)}</span>
        <button type="button" onClick={() => shift(1)}>
          {labels.nextMonth}
        </button>
        {/* 打刻はこの画面の外で起きる。一覧は自分では気付けないため、
            読み直す手立てを置く。 */}
        <button type="button" onClick={load}>
          {labels.reload}
        </button>
      </div>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {days === null && <p>{messages.loading}</p>}
      {days !== null && days.length === 0 && <p>{labels.noDays}</p>}

      {days !== null && days.length > 0 && (
        <ul className="history-list">
          {days.map((day) => (
            <li key={day.businessDate}>
              <button type="button" onClick={() => open(day.businessDate)}>
                {day.businessDate}
              </button>
              <span>{clock(day.firstClockInAt)}</span>
              <span>{clock(day.lastClockOutAt)}</span>
              <span>{day.workedMinutes === null ? '—' : labels.minutes(day.workedMinutes)}</span>
              <span>{day.editable ? labels.editable : labels.locked}</span>
            </li>
          ))}
        </ul>
      )}

      {selected !== null && (
        <div className="history-detail">
          <h3>{labels.detail(selected.businessDate)}</h3>
          <dl className="details">
            <dt>{labels.workedMinutesLabel}</dt>
            <dd>
              {selected.calculation === null
                ? '—'
                : labels.minutes(selected.calculation.workedMinutes)}
            </dd>
            <dt>{labels.editableLabel}</dt>
            <dd>{selected.editable ? labels.editable : labels.locked}</dd>
          </dl>

          <h4>{labels.punches}</h4>
          {selected.events.length === 0 ? (
            <p>{labels.noPunches}</p>
          ) : (
            <ul>
              {selected.events.map((event) => (
                <li key={event.id}>
                  {formatInstantInTimeZone(event.occurredAt, selected.timeZone, locale)}{' '}
                  {event.eventType}
                </li>
              ))}
            </ul>
          )}

          <button type="button" onClick={() => setSelected(null)}>
            {labels.close}
          </button>
        </div>
      )}
    </section>
  );
}
