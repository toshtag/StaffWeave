import { randomBytes } from 'node:crypto';
import {
  DEFAULT_API_KEY_USAGE_INTERVAL_MS,
  isApiScope,
  isWebhookEventType,
  shouldRecordApiKeyUse,
} from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import { ApiError, invalidRequest } from '../shared/errors.js';
import { hashToken } from '../shared/security/tokens.js';
import type {
  ApiKeyRecord,
  IntegrationRepository,
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
} from './repository.js';
import type { WebhookTargetValidator } from './webhook-network-policy.js';
import { WebhookTargetError } from './webhook-network-policy.js';
import { deriveWebhookSigningKey } from './webhook-signature.js';

export interface IntegrationServiceDependencies {
  repository: IntegrationRepository;
  now: () => Date;
  /** Webhook 送信先を登録してよいかの判断。内部ネットワーク宛の登録をここで止める。 */
  webhookTarget: WebhookTargetValidator;
  /** API キーの最後に使った時刻を書き直す間隔。省略すると既定値を使う。 */
  apiKeyUsageIntervalMs?: number;
}

export interface IntegrationService {
  listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]>;
  createApiKey(
    context: AuthenticatedContext,
    input: { name: string; scopes: string[] },
  ): Promise<{ apiKey: ApiKeyRecord; secret: string }>;
  revokeApiKey(workspaceId: string, apiKeyId: string): Promise<ApiKeyRecord>;
  /** `Authorization` ヘッダーから API キーを認証する。 */
  authenticate(
    header: string | undefined,
  ): Promise<{ workspaceId: string; scopes: string[] } | null>;

  listEndpoints(workspaceId: string): Promise<WebhookEndpointRecord[]>;
  createEndpoint(
    workspaceId: string,
    input: { name: string; url: string; eventTypes: string[] },
  ): Promise<{ endpoint: WebhookEndpointRecord; secret: string }>;
  listDeliveries(workspaceId: string): Promise<WebhookDeliveryRecord[]>;
}

const KEY_PREFIX = 'sw';

function generateApiKey(): { secret: string; prefix: string } {
  const prefix = randomBytes(4).toString('hex');
  const secret = `${KEY_PREFIX}_${prefix}_${randomBytes(24).toString('base64url')}`;
  return { secret, prefix };
}

export function createIntegrationService(deps: IntegrationServiceDependencies): IntegrationService {
  const usageIntervalMs = deps.apiKeyUsageIntervalMs ?? DEFAULT_API_KEY_USAGE_INTERVAL_MS;

  /**
   * 送信先の検査。理由は利用者へ返すが、検査の内部例外はそのまま外へ出さない。
   * 名前解決の失敗理由をそのまま返すと、内部ネットワークの構成を読み取る手掛かりになる。
   */
  const validateWebhookTarget = async (rawUrl: string): Promise<{ canonicalUrl: string }> => {
    try {
      return await deps.webhookTarget(rawUrl);
    } catch (error) {
      throw invalidRequest([
        {
          field: 'url',
          message:
            error instanceof WebhookTargetError
              ? error.message
              : 'Webhook 送信先を確認できませんでした',
        },
      ]);
    }
  };

  return {
    listApiKeys: (workspaceId) => deps.repository.listApiKeys(workspaceId),

    async createApiKey(context, input) {
      const scopes = input.scopes.filter((scope) => isApiScope(scope));
      if (scopes.length === 0) {
        throw invalidRequest([{ field: 'scopes', message: '有効なスコープを指定してください' }]);
      }

      const { secret, prefix } = generateApiKey();
      const apiKey = await deps.repository.createApiKey(context.workspace.id, {
        name: input.name,
        prefix,
        keyHash: hashToken(secret),
        scopes,
        createdByUserId: context.user.id,
      });

      // 生の鍵はこの応答でしか返さない。
      return { apiKey, secret };
    },

    async revokeApiKey(workspaceId, apiKeyId) {
      try {
        return await deps.repository.revokeApiKey(workspaceId, apiKeyId, deps.now());
      } catch {
        throw new ApiError('not_found', 'API キーが見つからないか、すでに失効しています');
      }
    },

    async authenticate(header) {
      if (header === undefined) return null;
      const [scheme, value] = header.split(' ');
      if (scheme !== 'Bearer' || value === undefined) return null;

      const principal = await deps.repository.findApiKeyByHash(hashToken(value));
      if (!principal) return null;

      // 最後に使った時刻は、使われなくなったキーを見分けるためのもの。
      // 要求のたびに書くと、読み取りだけの要求にも書き込みの待ち時間が乗る。
      const now = deps.now();
      if (shouldRecordApiKeyUse(principal.lastUsedAt, now, usageIntervalMs)) {
        await deps.repository.touchApiKey(
          principal.id,
          now,
          new Date(now.getTime() - usageIntervalMs),
        );
      }
      return { workspaceId: principal.workspaceId, scopes: principal.scopes };
    },

    listEndpoints: (workspaceId) => deps.repository.listEndpoints(workspaceId),

    async createEndpoint(workspaceId, input) {
      const eventTypes = input.eventTypes.filter((eventType) => isWebhookEventType(eventType));
      if (eventTypes.length === 0) {
        throw invalidRequest([
          { field: 'eventTypes', message: '有効な出来事の種別を指定してください' },
        ]);
      }

      // 検査を通るまでは、署名用の秘密も作らず repository にも触れない。
      // 拒んだ登録の痕跡を残さないようにする。
      const { canonicalUrl } = await validateWebhookTarget(input.url);

      // 保存するのは照合用のハッシュではなく、署名を生成できる鍵そのもの。
      // 対称鍵の HMAC である以上、送信側は署名を作れる値を持たざるを得ない。
      const signingSecret = randomBytes(24).toString('base64url');
      const endpoint = await deps.repository.createEndpoint(workspaceId, {
        name: input.name,
        url: canonicalUrl,
        signingKey: deriveWebhookSigningKey(signingSecret),
        eventTypes,
      });

      // 署名用の秘密はこの応答でしか返さない。
      return { endpoint, secret: signingSecret };
    },

    listDeliveries: (workspaceId) => deps.repository.listDeliveries(workspaceId, 200),
  };
}
