import type { JsonSchema } from '@staffweave/contracts';
import { validate } from '@staffweave/contracts';
import type { Context } from 'hono';
import { invalidRequest } from './errors.js';

/**
 * 要求本文を契約（JSON Schema）で検証して取り出す。
 * 契約に合わない要求はここで止め、以降の処理へ渡さない。
 */
export async function readBody<T>(c: Context, schema: JsonSchema): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalidRequest([{ field: '', message: 'JSON として解釈できません' }]);
  }

  const result = validate<T>(schema, raw);
  if (!result.valid) {
    throw invalidRequest(result.problems);
  }
  return result.value;
}
