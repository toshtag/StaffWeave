import type { Discrepancy } from '@staffweave/domain';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/**
 * 打刻と PC の利用記録の食い違い。
 *
 * ここに出るのは確認のための材料であり、打刻や集計が自動で書き換わることはない。
 */
export function DiscrepancyPanel({ businessDate }: { businessDate: string }): React.JSX.Element {
  const { messages } = useLocale();
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getDiscrepancyReport(businessDate)
      .then((report) => {
        if (!cancelled) setDiscrepancies(report.discrepancies);
      })
      .catch(() => {
        if (!cancelled) setDiscrepancies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [businessDate]);

  return (
    <section className="card">
      <h2>{messages.discrepancies}</h2>
      <p className="notice">{messages.discrepancyNotice}</p>

      {discrepancies === null && <p>{messages.loading}</p>}
      {discrepancies !== null && discrepancies.length === 0 && <p>{messages.noDiscrepancies}</p>}

      {discrepancies !== null && discrepancies.length > 0 && (
        <ul className="punch-list">
          {discrepancies.map((entry) => (
            <li key={`${entry.kind}-${entry.evidence.from ?? ''}`}>
              <span>{entry.evidence.note}</span>
              <span>{messages.discrepancyMinutes(entry.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
