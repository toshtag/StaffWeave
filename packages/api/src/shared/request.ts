import type { JsonSchema } from '@staffweave/contracts';
import { validate } from '@staffweave/contracts';
import type { Context } from 'hono';
import { invalidRequest, notFound } from './errors.js';

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

/**
 * 経路に含まれる識別子を取り出す。
 *
 * 経路は契約から組み立てるため、Hono は名前を静的に知らず、型は省略可能になる。
 * 契約と経路が食い違えば値が無いことになるので、その場合は対象が無いものとして扱う。
 */
export function pathParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) throw notFound('対象');
  return value;
}
