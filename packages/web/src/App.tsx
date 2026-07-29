import { useEffect, useState } from 'react';

type ProbeState = 'loading' | 'ok' | 'error';

interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

interface ReadinessResponse {
  status: string;
  checks: ReadinessCheck[];
}

interface Probe {
  state: ProbeState;
  detail: string;
}

const initialProbe: Probe = { state: 'loading', detail: '確認中' };

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<Probe>(initialProbe);
  const [readiness, setReadiness] = useState<Probe>(initialProbe);

  useEffect(() => {
    let cancelled = false;

    async function probe(): Promise<void> {
      try {
        const response = await fetch('/api/health');
        if (cancelled) return;
        setHealth(
          response.ok
            ? { state: 'ok', detail: '応答あり' }
            : { state: 'error', detail: `HTTP ${response.status}` },
        );
      } catch {
        if (!cancelled) setHealth({ state: 'error', detail: 'API へ接続できません' });
      }

      try {
        const response = await fetch('/api/ready');
        const body = (await response.json()) as ReadinessResponse;
        if (cancelled) return;
        const failed = body.checks.filter((check) => !check.ok);
        setReadiness(
          response.ok
            ? { state: 'ok', detail: 'データベースとマイグレーションは正常です' }
            : {
                state: 'error',
                detail: failed.map((check) => check.detail ?? check.name).join(' / '),
              },
        );
      } catch {
        if (!cancelled) setReadiness({ state: 'error', detail: 'API へ接続できません' });
      }
    }

    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>staffweave</h1>
      <p className="subtitle">セルフホスト可能な勤怠管理基盤（開発中）</p>

      <ul className="status-list">
        <li className="status-item">
          <span className="status-label">API 稼働確認</span>
          <span className="status-value" data-state={health.state}>
            {health.detail}
          </span>
        </li>
        <li className="status-item">
          <span className="status-label">受け入れ準備</span>
          <span className="status-value" data-state={readiness.state}>
            {readiness.detail}
          </span>
        </li>
      </ul>

      <p className="status-detail">
        この画面は基盤が動作していることの確認用です。勤怠機能はまだ実装されていません。
      </p>
    </main>
  );
}
