import type { JsonSchema } from './json-schema.js';
import { type OperationContract, operationList } from './operations.js';

export const API_BASE_PATH = '/api';

interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security?: Record<string, string[]>[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

/** クエリ用のオブジェクトスキーマを、OpenAPI のクエリパラメーターへ展開する。 */
function queryParametersOf(schema: JsonSchema | undefined): unknown[] {
  if (schema === undefined) return [];
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null) return [];
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  return Object.entries(properties as Record<string, JsonSchema>).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    ...(typeof property.description === 'string' ? { description: property.description } : {}),
    schema: property,
  }));
}

function toOpenApiOperation(operation: OperationContract): OpenApiOperation {
  const responses: Record<string, unknown> = {};
  const parameters = [
    ...(operation.pathParameters ?? []).map((parameter) => ({
      name: parameter.name,
      in: 'path',
      required: true,
      description: parameter.description,
      schema: parameter.schema,
    })),
    ...queryParametersOf(operation.query),
  ];
  for (const response of operation.responses) {
    // 応答の内容種別は操作が決める。失敗の応答はいつも JSON の error を返す。
    const contentType =
      response.status >= 400
        ? 'application/json'
        : (operation.responseContentType ?? 'application/json');
    responses[String(response.status)] = {
      description: response.description,
      ...(response.schema === undefined
        ? contentType === 'text/csv'
          ? { content: { 'text/csv': { schema: { type: 'string' } } } }
          : {}
        : { content: { [contentType]: { schema: response.schema } } }),
    };
  }

  return {
    operationId: operation.operationId,
    summary: operation.summary,
    tags: [...operation.tags],
    ...(operation.security === 'session' ? { security: [{ sessionCookie: [] }] } : {}),
    ...(operation.security === 'deviceSignature'
      ? { security: [{ deviceId: [], deviceSignature: [] }] }
      : {}),
    // どちらか一方で呼べることを、security の配列（OR）で表す。
    ...(operation.security === 'sessionOrApiKey'
      ? { security: [{ sessionCookie: [] }, { apiKey: [] }] }
      : {}),
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(operation.requestBody === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              [operation.requestContentType ?? 'application/json']: {
                schema: operation.requestBody,
              },
            },
          },
        }),
    responses,
  };
}

/**
 * 契約のパスを Hono の書き方へ直す。
 *
 * 契約は `/employees/{employeeId}`、Hono は `/employees/:employeeId` と書く。
 * ルート側で文字列を書き直すと、片方だけを変えたときに気付けないため、
 * 変換をここに置いて両方が同じ定義から出るようにする。
 */
export function honoPath(operation: { path: string }): string {
  return operation.path.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, ':$1');
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
        deviceId: {
          type: 'apiKey',
          in: 'header',
          name: 'x-staffweave-device',
          description: '打刻端末の識別子',
        },
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            '外部連携用の API キー。Authorization: Bearer <key> で渡す。' +
            'ワークスペース単位のスコープを持ち、組織単位の制限は持たない',
        },
        deviceSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-staffweave-signature',
          description:
            '端末の秘密鍵による Ed25519 署名（base64）。署名対象は canonicalPayload が定める文字列',
        },
      },
    },
  };
}
