import type { Organization, SessionResponse } from '@staffweave/contracts';
import { useEffect, useState } from 'react';
import {
  AdminConsole,
  adminHref,
  hasVisibleAdminSection,
  useAdminRoute,
} from '../admin/AdminConsole.tsx';
import { ApiRequestError, api } from '../api/client.ts';
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { businessToday } from '../session/business-date.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { ActiveSessions } from './ActiveSessions.tsx';
import { AnomalyPanel } from './AnomalyPanel.tsx';
import { ApiKeys } from './ApiKeys.tsx';
import { ChangePassword } from './ChangePassword.tsx';
import { DiscrepancyPanel } from './DiscrepancyPanel.tsx';
import { PendingApprovals } from './PendingApprovals.tsx';
import { TodayAttendance } from './TodayAttendance.tsx';

type OrganizationsState =
  | { status: 'loading' }
  | { status: 'ready'; organizations: Organization[] }
  | { status: 'forbidden' };

function OrganizationTable({ session }: { session: SessionResponse }): React.JSX.Element | null {
  const { messages } = useLocale();
  const [state, setState] = useState<OrganizationsState>({ status: 'loading' });

  const canRead = session.user.permissions.includes('organization.read');

  useEffect(() => {
    if (!canRead) {
      setState({ status: 'forbidden' });
      return;
    }
    let cancelled = false;
    api
      .listOrganizations()
      .then((body) => {
        if (!cancelled) setState({ status: 'ready', organizations: body.organizations });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof ApiRequestError && error.status === 403
            ? { status: 'forbidden' }
            : { status: 'ready', organizations: [] },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [canRead]);

  if (state.status === 'forbidden') return null;

  return (
    <section className="card">
      <h2>{messages.organizations}</h2>
      {state.status === 'loading' && <p>{messages.loading}</p>}
      {state.status === 'ready' && state.organizations.length === 0 && (
        <p>{messages.noOrganizations}</p>
      )}
      {state.status === 'ready' && state.organizations.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">{messages.organizationCode}</th>
              <th scope="col">{messages.organizationName}</th>
            </tr>
          </thead>
          <tbody>
            {state.organizations.map((organization) => (
              <tr key={organization.id}>
                <td>{organization.code}</td>
                <td>{organization.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function HomePage({ session }: { session: SessionResponse }): React.JSX.Element {
  const { locale, messages } = useLocale();
  const { signOut } = useSession();
  const adminRoute = useAdminRoute();

  // 設定は、日々の画面と混ぜない。開く人も頻度も違う。
  // 同じ画面へ並べると、毎日使う打刻の下に、年に数回しか触らない設定が積み上がる。
  if (adminRoute !== null) {
    return (
      <>
        <a className="skip-link" href="#main">
          {messages.skipToMain}
        </a>
        <header className="page-header">
          <div>
            <h1>{messages.admin.title}</h1>
            <p className="subtitle">{session.workspace.name}</p>
          </div>
          <div className="header-actions">
            <LocaleSwitcher />
            <a className="header-link" href="#/">
              {messages.admin.backToHome}
            </a>
          </div>
        </header>
        <main id="main" className="wide">
          <AdminConsole permissions={session.user.permissions} route={adminRoute} />
        </main>
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        {messages.skipToMain}
      </a>
      <header className="page-header">
        <div>
          <h1>{messages.appName}</h1>
          <p className="subtitle">{session.workspace.name}</p>
        </div>
        <div className="header-actions">
          <LocaleSwitcher />
          {hasVisibleAdminSection(session.user.permissions, messages.admin) && (
            <a className="header-link" href={adminHref('organization', 'organizations')}>
              {messages.admin.openConsole}
            </a>
          )}
          <button type="button" onClick={() => void signOut()}>
            {messages.signOut}
          </button>
        </div>
      </header>

      <main id="main">
        <TodayAttendance session={session} />

        {session.employee !== null && <DiscrepancyPanel businessDate={businessToday(session)} />}

        <PendingApprovals session={session} />

        <AnomalyPanel session={session} />

        <section className="card">
          <h2>{messages.signedInAs}</h2>
          <dl className="details">
            <dt>{session.user.displayName}</dt>
            <dd>{session.user.email}</dd>
            <dt>{messages.roles}</dt>
            <dd>{session.user.roles.join(', ')}</dd>
            <dt>{messages.employeeNumber}</dt>
            <dd>{session.employee?.employeeNumber ?? messages.noEmployeeLinked}</dd>
            <dt>{messages.sessionExpiresAt}</dt>
            <dd>{new Date(session.expiresAt).toLocaleString(locale)}</dd>
          </dl>
        </section>

        <ChangePassword />

        <ActiveSessions />

        <OrganizationTable session={session} />

        <ApiKeys session={session} />
      </main>
    </>
  );
}
