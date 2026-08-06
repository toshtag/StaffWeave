import type { Permission } from '@staffweave/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { CalculationRuleSettings } from './sections/CalculationRuleSettings.tsx';
import { DepartmentSettings } from './sections/DepartmentSettings.tsx';
import { EmployeeSettings } from './sections/EmployeeSettings.tsx';
import { LaborSystemSettings } from './sections/LaborSystemSettings.tsx';
import { LeaveLedgerSettings } from './sections/LeaveLedgerSettings.tsx';
import { LeaveTypeSettings } from './sections/LeaveTypeSettings.tsx';
import { OrganizationSettings } from './sections/OrganizationSettings.tsx';
import { RequestTypeSettings } from './sections/RequestTypeSettings.tsx';
import { SiteSettings } from './sections/SiteSettings.tsx';
import { UserScopeSettings } from './sections/UserScopeSettings.tsx';
import { WorkCategorySettings } from './sections/WorkCategorySettings.tsx';

/**
 * 設定の画面。
 *
 * 管理者が API や SQL を使わずに初期設定を終えられることを目安にしている。
 *
 * 上でモジュールを切り替え、左でその中の設定を選ぶ。設定は数が多く、
 * 一枚に並べると目的の項目まで辿り着けない。二段に分けると、
 * いま何を触っているかが見出しの位置で分かる。
 *
 * どこを見ているかは URL の後ろ（#/admin/組織/拠点）に持つ。
 * 画面の中だけに持つと、読み込み直したときに先頭へ戻り、
 * 「この設定はここ」と人へ伝えることもできない。
 */

export interface SectionProps {
  permissions: readonly Permission[];
}

interface SectionDefinition {
  key: string;
  label: string;
  /** 見るために要る権限。持たない利用者には出さない。 */
  requires: Permission;
  render: (props: SectionProps) => React.JSX.Element;
}

interface ModuleDefinition {
  key: string;
  label: string;
  sections: SectionDefinition[];
}

type AdminLabels = ReturnType<typeof useLocale>['messages']['admin'];

function modulesFor(labels: AdminLabels): ModuleDefinition[] {
  return [
    {
      key: 'organization',
      label: labels.moduleOrganization,
      sections: [
        {
          key: 'organizations',
          label: labels.sectionOrganizations,
          requires: 'organization.read',
          render: (props) => <OrganizationSettings {...props} />,
        },
        {
          key: 'sites',
          label: labels.sectionSites,
          requires: 'organization.read',
          render: (props) => <SiteSettings {...props} />,
        },
        {
          key: 'departments',
          label: labels.sectionDepartments,
          requires: 'organization.read',
          render: (props) => <DepartmentSettings {...props} />,
        },
      ],
    },
    {
      key: 'employee',
      label: labels.moduleEmployee,
      sections: [
        {
          key: 'employees',
          label: labels.sectionEmployees,
          requires: 'employee.read',
          render: (props) => <EmployeeSettings {...props} />,
        },
        {
          key: 'scopes',
          label: labels.sectionUserScopes,
          requires: 'user.manage',
          render: (props) => <UserScopeSettings {...props} />,
        },
      ],
    },
    {
      key: 'work',
      label: labels.moduleWork,
      sections: [
        {
          key: 'categories',
          label: labels.sectionWorkCategories,
          requires: 'organization.read',
          render: (props) => <WorkCategorySettings {...props} />,
        },
        {
          key: 'rules',
          label: labels.sectionCalculationRules,
          requires: 'organization.read',
          render: (props) => <CalculationRuleSettings {...props} />,
        },
        {
          key: 'labor-systems',
          label: labels.sectionLaborSystems,
          requires: 'employee.read',
          render: (props) => <LaborSystemSettings {...props} />,
        },
      ],
    },
    {
      key: 'leave',
      label: labels.moduleLeave,
      sections: [
        {
          key: 'leave-types',
          label: labels.sectionLeaveTypes,
          requires: 'leave.manage',
          render: (props) => <LeaveTypeSettings {...props} />,
        },
        {
          key: 'ledger',
          label: labels.sectionLeaveLedger,
          requires: 'leave.manage',
          render: (props) => <LeaveLedgerSettings {...props} />,
        },
      ],
    },
    {
      key: 'request',
      label: labels.moduleRequest,
      sections: [
        {
          key: 'request-types',
          label: labels.sectionRequestTypes,
          requires: 'request.manage',
          render: (props) => <RequestTypeSettings {...props} />,
        },
      ],
    },
  ];
}

/** URL の後ろから、いま見ている場所を読む。 */
function routeFromHash(): { module: string; section: string } | null {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] !== 'admin') return null;
  return { module: parts[1] ?? '', section: parts[2] ?? '' };
}

export function useAdminRoute(): { module: string; section: string } | null {
  const [route, setRoute] = useState(routeFromHash);

  useEffect(() => {
    const onChange = (): void => setRoute(routeFromHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function adminHref(module: string, section: string): string {
  return `#/admin/${module}/${section}`;
}

/**
 * 設定の入口を出してよいか。
 *
 * 1 つも見られない利用者へ入口だけ出すと、開いてから「何もありません」と伝えることになる。
 * 要る権限を別に並べ直さず、実際に出す設定の定義から数える。
 * 並べ直すと、設定を足したときに片方だけが古くなる。
 */
export function hasVisibleAdminSection(
  permissions: readonly Permission[],
  labels: AdminLabels,
): boolean {
  return modulesFor(labels).some((module) =>
    module.sections.some((section) => permissions.includes(section.requires)),
  );
}

export function AdminConsole({
  permissions,
  route,
}: {
  permissions: readonly Permission[];
  route: { module: string; section: string };
}): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;

  // 見られる設定だけを残す。空になったモジュールは見出しごと出さない。
  const modules = modulesFor(labels)
    .map((module) => ({
      ...module,
      sections: module.sections.filter((section) => permissions.includes(section.requires)),
    }))
    .filter((module) => module.sections.length > 0);

  const activeModule = modules.find((module) => module.key === route.module) ?? modules[0];
  const activeSection =
    activeModule?.sections.find((section) => section.key === route.section) ??
    activeModule?.sections[0];

  const tabs = useRef<HTMLDivElement>(null);

  /** 左右キーでモジュールを移る。タブとして扱う以上、矢印で動けないと使えない。 */
  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0 || activeModule === undefined) return;
      event.preventDefault();
      const index = modules.findIndex((module) => module.key === activeModule.key);
      const next = modules[(index + step + modules.length) % modules.length];
      if (next === undefined) return;
      window.location.hash = adminHref(next.key, next.sections[0]?.key ?? '');
      // 移った先のタブへ焦点を移す。押した場所に焦点が残ると、続けて押せない。
      requestAnimationFrame(() => {
        tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      });
    },
    [activeModule, modules],
  );

  if (activeModule === undefined || activeSection === undefined) {
    return (
      <section className="card">
        <h2>{labels.title}</h2>
        <p>{labels.nothingVisible}</p>
      </section>
    );
  }

  return (
    <div className="admin">
      <div
        className="admin-modules"
        role="tablist"
        aria-label={labels.moduleTablistLabel}
        ref={tabs}
        onKeyDown={onTabKeyDown}
      >
        {modules.map((module) => {
          const selected = module.key === activeModule.key;
          return (
            <a
              key={module.key}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              href={adminHref(module.key, module.sections[0]?.key ?? '')}
            >
              {module.label}
            </a>
          );
        })}
      </div>

      <div className="admin-body">
        <nav className="admin-sections" aria-label={activeModule.label}>
          <ul>
            {activeModule.sections.map((section) => (
              <li key={section.key}>
                <a
                  href={adminHref(activeModule.key, section.key)}
                  aria-current={section.key === activeSection.key ? 'page' : undefined}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="admin-content">{activeSection.render({ permissions })}</div>
      </div>
    </div>
  );
}
