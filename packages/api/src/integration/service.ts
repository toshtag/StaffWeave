import { randomBytes } from 'node:crypto';
import { isApiScope, isWebhookEventType } from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import { ApiError, invalidRequest } from '../shared/errors.js';
import { hashToken } from '../shared/security/tokens.js';
import type {
  ApiKeyRecord,
  IntegrationRepository,
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
} from './repository.js';

export interface IntegrationServiceDependencies {
  repository: IntegrationRepository;
  now: () => Date;
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

      await deps.repository.touchApiKey(principal.id, deps.now());
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

      const secret = randomBytes(24).toString('base64url');
      const endpoint = await deps.repository.createEndpoint(workspaceId, {
        name: input.name,
        url: input.url,
        secretHash: hashToken(secret),
        eventTypes,
      });

      // 署名用の秘密はこの応答でしか返さない。
      return { endpoint, secret };
    },

    listDeliveries: (workspaceId) => deps.repository.listDeliveries(workspaceId, 200),
  };
}
