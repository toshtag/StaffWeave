import { describe, expect, it } from 'vitest';
import type { JsonSchema } from './json-schema.js';
import { buildOpenApiDocument } from './openapi.js';
import { operationList, operations } from './operations.js';
import { loginRequestSchema, sessionResponseSchema } from './schemas/auth.js';
import { ORGANIZATION_SCOPE_DESCRIPTION } from './schemas/common.js';
import { createWebhookEndpointRequestSchema } from './schemas/integration.js';
import { createEmployeeRequestSchema } from './schemas/organization.js';
import type { CreateEmployeeRequest, LoginRequest, SessionResponse } from './types.js';
import { validate } from './validation.js';

describe('操作の定義', () => {
  it('operationId が重複しない', () => {
    const ids = operationList.map((operation) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('メソッドとパスの組が重複しない', () => {
    const keys = operationList.map((operation) => `${operation.method} ${operation.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('すべての操作が成功応答を持つ', () => {
    for (const operation of operationList) {
      const success = operation.responses.filter(
        (response) => response.status >= 200 && response.status < 300,
      );
      expect(success.length, operation.operationId).toBeGreaterThan(0);
    }
  });

  it('セッション必須の操作は 401 応答を定義している', () => {
    for (const operation of operationList) {
      if (operation.security !== 'session') continue;
      const statuses = operation.responses.map((response) => response.status);
      expect(statuses, operation.operationId).toContain(401);
    }
  });
});

describe('OpenAPI 文書', () => {
  const document = buildOpenApiDocument('1.2.3') as {
    openapi: string;
    info: { version: string };
    paths: Record<string, Record<string, unknown>>;
  };

  it('3.1 として組み立てられる', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe('1.2.3');
  });

  it('すべての操作がパスへ現れる', () => {
    for (const operation of operationList) {
      expect(document.paths[`/api${operation.path}`]?.[operation.method]).toBeDefined();
    }
  });

  it('同じパスの複数メソッドをまとめる', () => {
    expect(Object.keys(document.paths['/api/organizations'] ?? {}).sort()).toEqual(['get', 'post']);
  });
});

describe('要求の検証', () => {
  it('契約に沿ったログイン要求を受け入れる', () => {
    const input: LoginRequest = { email: 'person@example.com', password: 'correct horse ok' };
    const result = validate<LoginRequest>(loginRequestSchema, input);
    expect(result.valid).toBe(true);
  });

  it('短いパスワードを拒否し、対象の項目を示す', () => {
    const result = validate(loginRequestSchema, { email: 'person@example.com', password: 'x' });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.problems).toEqual([
      { field: 'password', message: '文字数が足りません（12 文字以上）' },
    ]);
  });

  it('契約にない項目を拒否する', () => {
    const result = validate(loginRequestSchema, {
      email: 'person@example.com',
      password: 'correct horse ok',
      isAdmin: true,
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.problems[0]?.message).toContain('契約にない項目');
  });

  it('必須項目の欠落を項目名付きで示す', () => {
    const result = validate(loginRequestSchema, { email: 'person@example.com' });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.problems).toEqual([
      { field: 'password', message: '必須の項目が入力されていません' },
    ]);
  });

  it('入れ子の項目でも位置を示す', () => {
    const input = {
      organizationId: '00000000-0000-4000-8000-000000000001',
      employeeNumber: 'E001',
      displayName: '検証 太郎',
      account: { email: 'person@example.com', password: 'short' },
    };
    const result = validate(createEmployeeRequestSchema, input);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.problems[0]?.field).toBe('account.password');
  });

  it('省略可能な項目を含む従業員登録を受け入れる', () => {
    const input: CreateEmployeeRequest = {
      organizationId: '00000000-0000-4000-8000-000000000001',
      employeeNumber: 'E001',
      displayName: '検証 太郎',
      hiredOn: '2026-04-01',
      account: {
        email: 'person@example.com',
        password: 'correct horse ok',
        locale: 'en',
        roles: ['employee'],
      },
    };
    expect(validate(createEmployeeRequestSchema, input).valid).toBe(true);
  });
});

describe('Webhook 送信先の契約', () => {
  const properties = createWebhookEndpointRequestSchema.properties as Record<string, JsonSchema>;
  const url = properties.url ?? {};

  it('URL の形式と長さの上限を示す', () => {
    expect(url).toMatchObject({ type: 'string', format: 'uri', maxLength: 2048 });
  });

  it('既定で公開ネットワークだけを指定できることを説明する', () => {
    expect(url.description).toContain('公開ネットワーク');
  });

  it('登録の失敗を 400 として定義している', () => {
    const statuses = operations.createWebhookEndpoint.responses.map((response) => response.status);
    expect(statuses).toContain(400);
  });

  // format は検証器の目安でしかない。到達してよいネットワークかどうかは API 側で検査する。
  it('契約の検証だけでは内部ネットワーク宛を弾かない', () => {
    const result = validate(createWebhookEndpointRequestSchema, {
      name: '連携先',
      url: 'http://127.0.0.1:8787/health',
      eventTypes: ['attendance_request.approved'],
    });
    expect(result.valid).toBe(true);
  });
});

describe('応答の型とスキーマの一致', () => {
  it('セッション応答が両方を満たす', () => {
    const response: SessionResponse = {
      workspace: {
        id: '00000000-0000-4000-8000-000000000001',
        slug: 'default',
        name: '既定のワークスペース',
        timeZone: 'Asia/Tokyo',
      },
      user: {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'person@example.com',
        displayName: '検証 太郎',
        locale: 'ja-JP',
        roles: ['workspace_admin'],
        permissions: ['organization.manage'],
        organizationScopes: [],
      },
      employee: null,
      expiresAt: '2026-04-01T12:00:00.000Z',
    };

    expect(validate(sessionResponseSchema, response).valid).toBe(true);
  });

  it('従業員が紐づく場合も満たす', () => {
    const response: SessionResponse = {
      workspace: {
        id: '00000000-0000-4000-8000-000000000001',
        slug: 'default',
        name: '既定のワークスペース',
        timeZone: 'Asia/Tokyo',
      },
      user: {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'person@example.com',
        displayName: '検証 太郎',
        locale: 'en',
        roles: ['employee'],
        permissions: [],
        organizationScopes: ['00000000-0000-4000-8000-000000000005'],
      },
      employee: {
        id: '00000000-0000-4000-8000-000000000003',
        employeeNumber: 'E001',
        displayName: '検証 太郎',
        organizationId: '00000000-0000-4000-8000-000000000004',
      },
      expiresAt: '2026-04-01T12:00:00.000Z',
    };

    expect(validate(sessionResponseSchema, response).valid).toBe(true);
  });
});

describe('operations の参照', () => {
  it('操作 ID から契約を引ける', () => {
    expect(operations.login.path).toBe('/auth/login');
    expect(operations.createEmployee.security).toBe('session');
  });
});

/**
 * 閲覧範囲は公開契約の一部である。
 *
 * スキーマの定義だけを見ても、生成された OpenAPI に載っているとは限らない。
 * 外部の実装者が読むのは生成物なので、生成物の側を検査する。
 */
describe('閲覧範囲の公開契約', () => {
  const document = buildOpenApiDocument('test') as {
    paths: Record<string, Record<string, { responses: Record<string, ResponseObject> }>>;
  };

  interface SchemaObject {
    description?: string;
    properties?: Record<string, SchemaObject>;
    items?: SchemaObject;
  }
  interface ResponseObject {
    content?: { 'application/json'?: { schema?: SchemaObject } };
  }

  function schemaOf(path: string, method: string, status: string): SchemaObject {
    const schema =
      document.paths[path]?.[method]?.responses[status]?.content?.['application/json']?.schema;
    if (!schema) throw new Error(`${method} ${path} の ${status} 応答が見つかりません`);
    return schema;
  }

  it('セッション応答が閲覧範囲の意味を説明している', () => {
    const scopes = schemaOf('/api/auth/session', 'get', '200').properties?.user?.properties
      ?.organizationScopes;
    expect(scopes?.description).toBe(ORGANIZATION_SCOPE_DESCRIPTION);
  });

  it('閲覧範囲の一覧が同じ説明を使う', () => {
    const item = schemaOf('/api/user-scopes', 'get', '200').properties?.scopes?.items;
    expect(item?.description).toBe(ORGANIZATION_SCOPE_DESCRIPTION);
  });

  it('閲覧範囲の登録が同じ説明を使う', () => {
    expect(schemaOf('/api/user-scopes', 'post', '201').description).toBe(
      ORGANIZATION_SCOPE_DESCRIPTION,
    );
  });

  it('旧い認可契約の説明が生成物へ現れない', () => {
    const json = JSON.stringify(document);
    for (const phrase of [
      '行が無ければワークスペース全体',
      '行がなければワークスペース全体',
      '空なら制限なし',
      '空ならワークスペース全体',
    ]) {
      expect(json, phrase).not.toContain(phrase);
    }
  });
});
