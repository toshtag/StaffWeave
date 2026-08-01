import { operations } from '@staffweave/contracts';
import type { Database } from '@staffweave/db';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
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
import { createCardRoutes, createDisabledCardRoutes } from './card/routes.js';
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
import type { StructuredLogger } from './shared/logger.js';
import { createConsoleLogger } from './shared/logger.js';
import {
  createRequestBodyLimit,
  DEFAULT_BULK_REQUEST_BODY_MAX_BYTES,
  DEFAULT_REQUEST_BODY_MAX_BYTES,
} from './shared/security/body-limit.js';
import { securityHeaderOptions } from './shared/security/headers.js';
import { createSystemRoutes } from './system/routes.js';

/** 上限を大きく取る経路。API は `/api` の下に置くため、要求から見える形で持つ。 */
const BULK_REQUEST_PATHS = [`/api${operations.importEmployeesCsv.path}`] as const;

export interface AppDependencies {
  db: Database;
  now?: () => Date;
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug?: string;
  /** 本番環境では Cookie に Secure を付ける。 */
  useSecureCookie?: boolean;
  /**
   * IC カードの指紋鍵の元になる共通の鍵。
   * 未設定ならカードの経路を無効にする。鍵なしで計算した指紋を受け取らないため。
   */
  cardFingerprintMasterKey?: string | null;
  /** Webhook 送信先として許すネットワークの範囲。既定は公開ネットワークだけ。 */
  webhookNetworkPolicy?: WebhookNetworkPolicyMode;
  /** 送信先の検査。テストから名前解決を伴わない実装へ差し替えるために開ける。 */
  webhookTargetValidator?: WebhookTargetValidator;
  /** 送信先の登録時に、URL と名前解決を確かめる上限時間。 */
  webhookTargetValidationTimeoutMs?: number;
  /**
   * 応答へ出さない失敗の詳細を書き出す先。
   * 既定では標準出力へ出す。テストからは差し替えられる。
   */
  logger?: StructuredLogger;
  /** 要求本文の上限。ふつうの要求と、まとまった量を受け取る要求で分ける。 */
  requestBodyLimit?: { defaultMaxBytes: number; bulkMaxBytes: number };
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? createConsoleLogger('api');
  const cardFingerprintMasterKey = deps.cardFingerprintMasterKey ?? null;

  const identityService = createIdentityService({
    repository: createIdentityRepository(deps.db),
    now,
    defaultWorkspaceSlug: deps.defaultWorkspaceSlug ?? 'default',
  });

  const assignmentRepository = createAssignmentRepository(deps.db);
  // 従業員データを見てよい相手の判断は、どの機能からも同じ実装を通す。
  const visibility = createEmployeeVisibilityGuard({ assignments: assignmentRepository, now });

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
    // 認証した相手向けの応答は保管させない。共有端末の戻る操作や中間の控えに残さないため。
    c.header('cache-control', 'no-store');
  });

  api.route('/', createSystemRoutes({ db: deps.db, now, logger }));
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
  // 指紋鍵が無い構成では、カードの経路を受け付けない。
  // 鍵なしで計算した指紋は、保存した値からカードを言い当てられる。
  api.route(
    '/',
    cardFingerprintMasterKey === null
      ? createDisabledCardRoutes()
      : createCardRoutes({ service: cardService }),
  );
  api.route('/', createSessionRoutes({ service: sessionService }));

  const app = new Hono<AppEnv>();

  // 防御用のヘッダーは、この 1 箇所で全部の応答へ付ける。
  // セルフホストでは同じプロセスが API と画面の両方を返すため、経路ごとには分けない。
  app.use('*', secureHeaders(securityHeaderOptions(deps.useSecureCookie ?? false)));

  // 本文の上限は、認証より前に効かせる。読み切ってから断るのでは遅い。
  app.use(
    '*',
    createRequestBodyLimit({
      defaultMaxBytes: deps.requestBodyLimit?.defaultMaxBytes ?? DEFAULT_REQUEST_BODY_MAX_BYTES,
      bulkMaxBytes: deps.requestBodyLimit?.bulkMaxBytes ?? DEFAULT_BULK_REQUEST_BODY_MAX_BYTES,
      bulkPaths: BULK_REQUEST_PATHS,
    }),
  );

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
