import type { AnomalyRecord, SessionResponse } from '@staffweave/contracts';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/** 直近 1 か月を確認の対象にする。 */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

/**
 * 確認が必要な記録。
 * 検出したものが不正であるとは限らないため、根拠を添えて判断を人へ委ねる。
 */
export function AnomalyPanel({ session }: { session: SessionResponse }): React.JSX.Element | null {
  const { messages } = useLocale();
  const [anomalies, setAnomalies] = useState<AnomalyRecord[] | null>(null);
  const range = useMemo(defaultRange, []);

  const canRead = session.user.permissions.includes('employee.read');

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    api
      .listAnomalies(range)
      .then((body) => {
        if (!cancelled) setAnomalies(body.anomalies);
      })
      .catch(() => {
        if (!cancelled) setAnomalies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, range]);

  if (!canRead) return null;

  return (
    <section className="card">
      <h2>{messages.anomalies}</h2>
      <p className="notice">{messages.anomalyNotice}</p>

      {anomalies === null && <p>{messages.loading}</p>}
      {anomalies !== null && anomalies.length === 0 && <p>{messages.noAnomalies}</p>}

      {anomalies !== null && anomalies.length > 0 && (
        <ul className="punch-list">
          {anomalies.map((anomaly) => (
            <li key={`${anomaly.kind}-${anomaly.summary}-${anomaly.detectedAt}`}>
              <span>{anomaly.summary}</span>
              <span className="anomaly-severity" data-severity={anomaly.severity}>
                {anomaly.severity === 'warning' ? messages.severityWarning : messages.severityInfo}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="notice">
        <a href={`/api/audit/anomalies?from=${range.from}&to=${range.to}&format=csv`}>
          {messages.downloadCsv}
        </a>
      </p>
    </section>
  );
}
