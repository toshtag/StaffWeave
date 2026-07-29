import { createHmac, randomBytes } from 'node:crypto';
import type { WebhookEventType } from '@staffweave/domain';
import { canonicalWebhookMessage, isApiScope, isWebhookEventType } from '@staffweave/domain';
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
  /** 送信の実装。テストから差し替えられるようにする。 */
  send?: (url: string, headers: Record<string, string>, body: string) => Promise<Response>;
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
  /** 出来事を登録済みの送信先へ通知する。送信の成否は記録として残す。 */
  dispatch(workspaceId: string, eventType: WebhookEventType, payload: unknown): Promise<void>;
}

const KEY_PREFIX = 'sw';

function generateApiKey(): { secret: string; prefix: string } {
  const prefix = randomBytes(4).toString('hex');
  const secret = `${KEY_PREFIX}_${prefix}_${randomBytes(24).toString('base64url')}`;
  return { secret, prefix };
}

export function createIntegrationService(deps: IntegrationServiceDependencies): IntegrationService {
  const send = deps.send ?? ((url, headers, body) => fetch(url, { method: 'POST', headers, body }));

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

    async dispatch(workspaceId, eventType, payload) {
      const endpoints = await deps.repository.listActiveEndpointsFor(workspaceId, eventType);
      if (endpoints.length === 0) return;

      const attemptedAt = deps.now();
      const eventId = randomBytes(12).toString('hex');
      const timestamp = attemptedAt.toISOString();
      const body = JSON.stringify({ eventId, eventType, occurredAt: timestamp, data: payload });

      for (const endpoint of endpoints) {
        // 署名にはハッシュではなく秘密そのものが必要だが、サーバーはハッシュしか持たない。
        // ハッシュを鍵として使うことで、保存物が漏れても受け取り側の検証鍵は別に保てる。
        const signature = createHmac('sha256', endpoint.secretHash)
          .update(canonicalWebhookMessage({ eventId, eventType, timestamp, body }), 'utf8')
          .digest('base64');

        let statusCode: number | null = null;
        let outcome: WebhookDeliveryRecord['outcome'] = 'failed';
        let errorMessage: string | null = null;

        try {
          const response = await send(
            endpoint.url,
            {
              'content-type': 'application/json',
              'x-staffweave-event': eventType,
              'x-staffweave-event-id': eventId,
              'x-staffweave-timestamp': timestamp,
              'x-staffweave-signature': signature,
            },
            body,
          );
          statusCode = response.status;
          outcome = response.ok ? 'delivered' : 'failed';
          if (!response.ok) errorMessage = `HTTP ${response.status}`;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : '送信に失敗しました';
        }

        await deps.repository.recordDelivery(workspaceId, {
          endpointId: endpoint.id,
          eventType,
          eventId,
          payload,
          attemptedAt,
          statusCode,
          outcome,
          errorMessage,
        });
      }
    },
  };
}
