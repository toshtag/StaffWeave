import type { Database } from '@staffweave/db';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createApprovalRepository } from './approval/repository.js';
import { createApprovalRoutes } from './approval/routes.js';
import { createApprovalService } from './approval/service.js';
import { createCalculationRepository } from './attendance/calculation-repository.js';
import { createAttendanceRepository } from './attendance/repository.js';
import { createAttendanceRoutes } from './attendance/routes.js';
import { createAttendanceService } from './attendance/service.js';
import { createAuditRepository } from './audit/repository.js';
import { createIdentityRepository } from './identity/repository.js';
import { createIdentityRoutes, SESSION_COOKIE_NAME } from './identity/routes.js';
import { createIdentityService } from './identity/service.js';
import { createOrganizationRepository } from './organization/repository.js';
import { createOrganizationRoutes } from './organization/routes.js';
import { createOrganizationService } from './organization/service.js';
import { createScheduleRepository } from './schedule/repository.js';
import { createScheduleRoutes } from './schedule/routes.js';
import { createScheduleService } from './schedule/service.js';
import type { AppEnv } from './shared/context.js';
import { ApiError } from './shared/errors.js';
import { createSystemRoutes } from './system/routes.js';

export interface AppDependencies {
  db: Database;
  now?: () => Date;
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug?: string;
  /** 本番環境では Cookie に Secure を付ける。 */
  useSecureCookie?: boolean;
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const now = deps.now ?? (() => new Date());

  const identityService = createIdentityService({
    repository: createIdentityRepository(deps.db),
    now,
    defaultWorkspaceSlug: deps.defaultWorkspaceSlug ?? 'default',
  });

  const organizationService = createOrganizationService({
    repository: createOrganizationRepository(deps.db),
    transaction: (fn) => deps.db.transaction((tx) => fn(createOrganizationRepository(tx))),
  });

  const dayRepositories = {
    attendance: createAttendanceRepository(deps.db),
    schedule: createScheduleRepository(deps.db),
    calculations: createCalculationRepository(deps.db),
    approval: createApprovalRepository(deps.db),
  };

  const withTransaction = <T>(
    fn: (repositories: {
      attendance: ReturnType<typeof createAttendanceRepository>;
      schedule: ReturnType<typeof createScheduleRepository>;
      calculations: ReturnType<typeof createCalculationRepository>;
      approval: ReturnType<typeof createApprovalRepository>;
      audit: ReturnType<typeof createAuditRepository>;
    }) => Promise<T>,
  ): Promise<T> =>
    deps.db.transaction((tx) =>
      fn({
        attendance: createAttendanceRepository(tx),
        schedule: createScheduleRepository(tx),
        calculations: createCalculationRepository(tx),
        approval: createApprovalRepository(tx),
        audit: createAuditRepository(tx),
      }),
    );

  const attendanceService = createAttendanceService({
    repositories: dayRepositories,
    now,
    transaction: withTransaction,
  });

  const scheduleService = createScheduleService({
    repositories: dayRepositories,
    transaction: withTransaction,
  });

  const approvalService = createApprovalService({
    repository: dayRepositories.approval,
    now,
    transaction: withTransaction,
  });

  const api = new Hono<AppEnv>();

  // 認証は一箇所で行い、各ルートは c.get('auth') を通じてのみ利用者を知る。
  api.use('*', async (c, next) => {
    c.set('auth', await identityService.authenticate(getCookie(c, SESSION_COOKIE_NAME)));
    await next();
  });

  api.route('/', createSystemRoutes({ db: deps.db, now }));
  api.route(
    '/',
    createIdentityRoutes({
      service: identityService,
      useSecureCookie: deps.useSecureCookie ?? false,
    }),
  );
  api.route('/', createOrganizationRoutes({ service: organizationService }));
  api.route('/', createAttendanceRoutes({ service: attendanceService }));
  api.route('/', createScheduleRoutes({ service: scheduleService }));
  api.route('/', createApprovalRoutes({ service: approvalService }));

  const app = new Hono<AppEnv>();
  app.route('/api', api);

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: '該当する API がありません' } }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(error.toResponseBody(), error.status as 400);
    }
    console.error(error);
    return c.json(
      { error: { code: 'internal_error', message: 'サーバー内部でエラーが発生しました' } },
      500,
    );
  });

  return app;
}
