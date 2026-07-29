import type { Queryable } from '@staffweave/db';

/**
 * API キーと Webhook の永続化。
 * 鍵と秘密は生の値を保存せず、照合できるハッシュだけを持つ。
 */

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyPrincipal {
  id: string;
  workspaceId: string;
  scopes: string[];
}

export interface WebhookEndpointRecord {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  eventType: string;
  eventId: string;
  attemptedAt: string;
  statusCode: number | null;
  outcome: 'delivered' | 'failed' | 'skipped';
  errorMessage: string | null;
}

export interface IntegrationRepository {
  listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]>;
  createApiKey(
    workspaceId: string,
    input: {
      name: string;
      prefix: string;
      keyHash: string;
      scopes: readonly string[];
      createdByUserId: string;
    },
  ): Promise<ApiKeyRecord>;
  revokeApiKey(workspaceId: string, apiKeyId: string, revokedAt: Date): Promise<ApiKeyRecord>;
  findApiKeyByHash(keyHash: string): Promise<ApiKeyPrincipal | null>;
  touchApiKey(apiKeyId: string, usedAt: Date): Promise<void>;

  listEndpoints(workspaceId: string): Promise<WebhookEndpointRecord[]>;
  listActiveEndpointsFor(
    workspaceId: string,
    eventType: string,
  ): Promise<{ id: string; url: string; secretHash: string }[]>;
  createEndpoint(
    workspaceId: string,
    input: { name: string; url: string; secretHash: string; eventTypes: readonly string[] },
  ): Promise<WebhookEndpointRecord>;
  recordDelivery(
    workspaceId: string,
    input: {
      endpointId: string;
      eventType: string;
      eventId: string;
      payload: unknown;
      attemptedAt: Date;
      statusCode: number | null;
      outcome: WebhookDeliveryRecord['outcome'];
      errorMessage: string | null;
    },
  ): Promise<void>;
  listDeliveries(workspaceId: string, limit: number): Promise<WebhookDeliveryRecord[]>;
}

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface EndpointRow {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  active: boolean;
  created_at: Date;
}

const API_KEY_COLUMNS = 'id, name, prefix, scopes, created_at, last_used_at, revoked_at';
const ENDPOINT_COLUMNS = 'id, name, url, event_types, active, created_at';

function toApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

function toEndpoint(row: EndpointRow): WebhookEndpointRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    eventTypes: row.event_types,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

export function createIntegrationRepository(db: Queryable): IntegrationRepository {
  return {
    async listApiKeys(workspaceId) {
      const rows = await db.query<ApiKeyRow>(
        `SELECT ${API_KEY_COLUMNS} FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [workspaceId],
      );
      return rows.map(toApiKey);
    },

    async createApiKey(workspaceId, input) {
      const rows = await db.query<ApiKeyRow>(
        `INSERT INTO api_keys (workspace_id, name, prefix, key_hash, scopes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${API_KEY_COLUMNS}`,
        [
          workspaceId,
          input.name,
          input.prefix,
          input.keyHash,
          [...input.scopes],
          input.createdByUserId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('API キーを作成できませんでした');
      return toApiKey(row);
    },

    async revokeApiKey(workspaceId, apiKeyId, revokedAt) {
      const rows = await db.query<ApiKeyRow>(
        `UPDATE api_keys SET revoked_at = $3
          WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
          RETURNING ${API_KEY_COLUMNS}`,
        [workspaceId, apiKeyId, revokedAt],
      );
      const row = rows[0];
      if (!row) throw new Error('API キーを失効させられませんでした');
      return toApiKey(row);
    },

    async findApiKeyByHash(keyHash) {
      const rows = await db.query<{ id: string; workspace_id: string; scopes: string[] }>(
        'SELECT id, workspace_id, scopes FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
        [keyHash],
      );
      const row = rows[0];
      return row ? { id: row.id, workspaceId: row.workspace_id, scopes: row.scopes } : null;
    },

    async touchApiKey(apiKeyId, usedAt) {
      await db.query('UPDATE api_keys SET last_used_at = $2 WHERE id = $1', [apiKeyId, usedAt]);
    },

    async listEndpoints(workspaceId) {
      const rows = await db.query<EndpointRow>(
        `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoints
          WHERE workspace_id = $1 ORDER BY created_at`,
        [workspaceId],
      );
      return rows.map(toEndpoint);
    },

    async listActiveEndpointsFor(workspaceId, eventType) {
      const rows = await db.query<{ id: string; url: string; secret_hash: string }>(
        `SELECT id, url, secret_hash FROM webhook_endpoints
          WHERE workspace_id = $1 AND active AND $2 = ANY(event_types)`,
        [workspaceId, eventType],
      );
      return rows.map((row) => ({ id: row.id, url: row.url, secretHash: row.secret_hash }));
    },

    async createEndpoint(workspaceId, input) {
      const rows = await db.query<EndpointRow>(
        `INSERT INTO webhook_endpoints (workspace_id, name, url, secret_hash, event_types)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ENDPOINT_COLUMNS}`,
        [workspaceId, input.name, input.url, input.secretHash, [...input.eventTypes]],
      );
      const row = rows[0];
      if (!row) throw new Error('Webhook を登録できませんでした');
      return toEndpoint(row);
    },

    async recordDelivery(workspaceId, input) {
      await db.query(
        `INSERT INTO webhook_deliveries
           (workspace_id, endpoint_id, event_type, event_id, payload, attempted_at,
            status_code, outcome, error_message)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        [
          workspaceId,
          input.endpointId,
          input.eventType,
          input.eventId,
          JSON.stringify(input.payload),
          input.attemptedAt,
          input.statusCode,
          input.outcome,
          input.errorMessage,
        ],
      );
    },

    async listDeliveries(workspaceId, limit) {
      const rows = await db.query<{
        id: string;
        endpoint_id: string;
        event_type: string;
        event_id: string;
        attempted_at: Date;
        status_code: number | null;
        outcome: WebhookDeliveryRecord['outcome'];
        error_message: string | null;
      }>(
        `SELECT id, endpoint_id, event_type, event_id, attempted_at, status_code, outcome,
                error_message
           FROM webhook_deliveries
          WHERE workspace_id = $1
          ORDER BY attempted_at DESC LIMIT $2`,
        [workspaceId, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        endpointId: row.endpoint_id,
        eventType: row.event_type,
        eventId: row.event_id,
        attemptedAt: row.attempted_at.toISOString(),
        statusCode: row.status_code,
        outcome: row.outcome,
        errorMessage: row.error_message,
      }));
    },
  };
}
