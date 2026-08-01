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
import { createAnomalyRepository } from './audit/anomaly-repository.js';
import { createAnomalyService } from './audit/anomaly-service.js';
import { createAuditRepository } from './audit/repository.js';
import { createAuditRoutes } from './audit/routes.js';
import { createCardRepository } from './card/repository.js';
import { createCardRoutes } from './card/routes.js';
import { createCardService } from './card/service.js';
import { createDeviceRepository } from './device/repository.js';
import { createDeviceRoutes } from './device/routes.js';
import { createDeviceService } from './device/service.js';
import { createIdentityRepository } from './identity/repository.js';
import { createIdentityRoutes, SESSION_COOKIE_NAME } from './identity/routes.js';
import { createIdentityService } from './identity/service.js';
import { createExportService } from './integration/export-service.js';
import { createWebhookOutboxRepository } from './integration/outbox-repository.js';
import { createWebhookOutboxWriter } from './integration/outbox-writer.js';
import { createIntegrationRepository } from './integration/repository.js';
import { createIntegrationRoutes } from './integration/routes.js';
import { createIntegrationService } from './integration/service.js';
import type {
  WebhookNetworkPolicyMode,
  WebhookTargetValidator,
} from './integration/webhook-network-policy.js';
import {
  createWebhookNetworkPolicy,
  createWebhookTargetValidator,
} from './integration/webhook-network-policy.js';
import { createAssignmentRepository } from './organization/assignment-repository.js';
import { createAssignmentRoutes } from './organization/assignment-routes.js';
import { createAssignmentService } from './organization/assignment-service.js';
import { createOrganizationRepository } from './organization/repository.js';
import { createOrganizationRoutes } from './organization/routes.js';
import { createOrganizationService } from './organization/service.js';
import { createWorkCycleRepository } from './schedule/cycle-repository.js';
import { createScheduleRepository } from './schedule/repository.js';
import { createScheduleRoutes } from './schedule/routes.js';
import { createScheduleService } from './schedule/service.js';
import { createSessionObservationRepository } from './session/repository.js';
import { createSessionRoutes } from './session/routes.js';
import { createSessionService } from './session/service.js';
import type { AppEnv } from './shared/context.js';
import { createEmployeeVisibilityGuard } from './shared/employee-visibility.js';
import { ApiError } from './shared/errors.js';
import { createSystemRoutes } from './system/routes.js';

export interface AppDependencies {
  db: Database;
  now?: () => Date;
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug?: string;
  /** 本番環境では Cookie に Secure を付ける。 */
  useSecureCookie?: boolean;
  /**
   * IC カードの指紋鍵の元になる共通の鍵。
   * 端末へ渡すのは、ここから Workspace ごとに導出した鍵。未設定ならカード機能は使えない。
   */
  cardFingerprintMasterKey?: string | null;
  /** Webhook 送信先として許すネットワークの範囲。既定は公開ネットワークだけ。 */
  webhookNetworkPolicy?: WebhookNetworkPolicyMode;
  /** 送信先の検査。テストから名前解決を伴わない実装へ差し替えるために開ける。 */
  webhookTargetValidator?: WebhookTargetValidator;
  /** 送信先の登録時に、URL と名前解決を確かめる上限時間。 */
  webhookTargetValidationTimeoutMs?: number;
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const now = deps.now ?? (() => new Date());
  const cardFingerprintMasterKey = deps.cardFingerprintMasterKey ?? null;

  const identityService = createIdentityService({
    repository: createIdentityRepository(deps.db),
    now,
    defaultWorkspaceSlug: deps.defaultWorkspaceSlug ?? 'default',
  });

  const assignmentRepository = createAssignmentRepository(deps.db);
  // 従業員データを見てよい相手の判断は、どの機能からも同じ実装を通す。
  const visibility = createEmployeeVisibilityGuard(assignmentRepository);

  const organizationService = createOrganizationService({
    repository: createOrganizationRepository(deps.db),
    visibility,
    transaction: (fn) => deps.db.transaction((tx) => fn(createOrganizationRepository(tx))),
  });

  const assignmentService = createAssignmentService({
    repository: assignmentRepository,
    visibility,
  });

  const integrationService = createIntegrationService({
    repository: createIntegrationRepository(deps.db),
    now,
    webhookTarget:
      deps.webhookTargetValidator ??
      createWebhookTargetValidator(
        createWebhookNetworkPolicy({ mode: deps.webhookNetworkPolicy ?? 'public-only' }),
        { timeoutMs: deps.webhookTargetValidationTimeoutMs ?? 3_000 },
      ),
  });

  const anomalyService = createAnomalyService({
    repository: createAnomalyRepository(deps.db),
    visibility,
    now,
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
      devices: ReturnType<typeof createDeviceRepository>;
      cards: ReturnType<typeof createCardRepository>;
      observations: ReturnType<typeof createSessionObservationRepository>;
      audit: ReturnType<typeof createAuditRepository>;
      outbox: ReturnType<typeof createWebhookOutboxWriter>;
    }) => Promise<T>,
  ): Promise<T> =>
    deps.db.transaction((tx) =>
      fn({
        attendance: createAttendanceRepository(tx),
        schedule: createScheduleRepository(tx),
        calculations: createCalculationRepository(tx),
        approval: createApprovalRepository(tx),
        devices: createDeviceRepository(tx),
        cards: createCardRepository(tx),
        observations: createSessionObservationRepository(tx),
        audit: createAuditRepository(tx),
        // 外部への通知は送信待ちとして同じトランザクションで確定させる。
        // 実際の HTTP 送信は webhook-worker が行うため、ここでは通信しない。
        outbox: createWebhookOutboxWriter({
          endpoints: createIntegrationRepository(tx),
          outbox: createWebhookOutboxRepository(tx),
        }),
      }),
    );

  const attendanceService = createAttendanceService({
    repositories: dayRepositories,
    now,
    transaction: withTransaction,
  });

  const scheduleService = createScheduleService({
    repositories: dayRepositories,
    cycles: createWorkCycleRepository(deps.db),
    visibility,
    transaction: withTransaction,
  });

  const deviceService = createDeviceService({
    repository: createDeviceRepository(deps.db),
    attendance: dayRepositories.attendance,
    now,
    cardFingerprintMasterKey,
    transaction: withTransaction,
  });

  const cardService = createCardService({
    cards: createCardRepository(deps.db),
    devices: createDeviceRepository(deps.db),
    visibility,
    now,
    transaction: withTransaction,
  });

  const sessionService = createSessionService({
    repositories: dayRepositories,
    observations: createSessionObservationRepository(deps.db),
    devices: createDeviceRepository(deps.db),
    visibility,
    now,
    transaction: withTransaction,
  });

  const approvalService = createApprovalService({
    repository: dayRepositories.approval,
    visibility,
    now,
    transaction: withTransaction,
  });

  const api = new Hono<AppEnv>();

  // 認証は一箇所で行い、各ルートは c.get('auth') / c.get('apiKey') を通じてのみ相手を知る。
  api.use('*', async (c, next) => {
    c.set('auth', await identityService.authenticate(getCookie(c, SESSION_COOKIE_NAME)));
    c.set('apiKey', await integrationService.authenticate(c.req.header('authorization')));
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
  api.route('/', createAssignmentRoutes({ service: assignmentService }));
  api.route(
    '/',
    createAuditRoutes({ anomalies: anomalyService, logs: createAuditRepository(deps.db) }),
  );
  api.route(
    '/',
    createIntegrationRoutes({
      integration: integrationService,
      exports: createExportService(deps.db),
      organization: organizationService,
      visibility,
    }),
  );
  api.route('/', createAttendanceRoutes({ service: attendanceService }));
  api.route('/', createScheduleRoutes({ service: scheduleService }));
  api.route('/', createApprovalRoutes({ service: approvalService }));
  api.route('/', createDeviceRoutes({ service: deviceService }));
  api.route('/', createCardRoutes({ service: cardService }));
  api.route('/', createSessionRoutes({ service: sessionService }));

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
