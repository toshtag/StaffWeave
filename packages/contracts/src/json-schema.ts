/**
 * 契約で使う JSON Schema の最小型。
 *
 * スキーマ同士を `$ref` で結ばず、TypeScript のオブジェクト合成で組み立てる。
 * こうすると検証器（Ajv）と OpenAPI 文書の両方で、追加の解決処理なしに同じ定義を使える。
 */
export type JsonSchema = { readonly [key: string]: unknown };

export function objectSchema(definition: {
  properties: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  description?: string;
}): JsonSchema {
  return {
    type: 'object',
    properties: definition.properties,
    required: definition.required ?? [],
    additionalProperties: definition.additionalProperties ?? false,
    ...(definition.description === undefined ? {} : { description: definition.description }),
  };
}

export function arraySchema(items: JsonSchema, description?: string): JsonSchema {
  return {
    type: 'array',
    items,
    ...(description === undefined ? {} : { description }),
  };
}
