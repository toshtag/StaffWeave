import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi.js';
import { operationList, operations } from './operations.js';
import { loginRequestSchema, sessionResponseSchema } from './schemas/auth.js';
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
