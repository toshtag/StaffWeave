import { type OperationContract, operationList } from './operations.js';

export const API_BASE_PATH = '/api';

interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security?: { sessionCookie: string[] }[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

function toOpenApiOperation(operation: OperationContract): OpenApiOperation {
  const responses: Record<string, unknown> = {};
  for (const response of operation.responses) {
    responses[String(response.status)] = {
      description: response.description,
      ...(response.schema === undefined
        ? {}
        : { content: { 'application/json': { schema: response.schema } } }),
    };
  }

  return {
    operationId: operation.operationId,
    summary: operation.summary,
    tags: [...operation.tags],
    ...(operation.security === 'session' ? { security: [{ sessionCookie: [] }] } : {}),
    ...(operation.requestBody === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: operation.requestBody } },
          },
        }),
    responses,
  };
}

/**
 * OpenAPI 3.1 文書を組み立てる。
 * Web・Agent・外部連携はこの文書を共通の契約として参照する。
 */
export function buildOpenApiDocument(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of operationList) {
    const path = `${API_BASE_PATH}${operation.path}`;
    const existing = paths[path] ?? {};
    existing[operation.method] = toOpenApiOperation(operation);
    paths[path] = existing;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'staffweave API',
      version,
      description:
        'セルフホスト可能な勤怠管理基盤の API。すべての業務データはワークスペースに属する。',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'staffweave_session',
          description: 'ログイン時に発行されるセッション Cookie',
        },
      },
    },
  };
}
