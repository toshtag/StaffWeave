import { API_BASE_PATH, honoPath, operations } from '@staffweave/contracts';
import type { Database, Queryable } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

/**
 * 実際に登録されている経路と、契約に登録されている操作が一致することを固定する。
 *
 * OpenAPI は Web・Agent・外部連携の共通契約であり、
 * 契約に無い経路があると、利用者は使える API の一部を知らないまま実装することになる。
 * 経路を足したときも消したときも、この検査が食い違いを知らせる。
 */

function createStubDatabase(): Database {
  return {
    query: async () => [],
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => fn({ query: async () => [] }),
    ping: async () => {},
    close: async () => {},
  };
}

/** 認証や配信の都合で足している、契約に出さない経路。 */
const UNCONTRACTED = new Set([
  'GET /api/openapi.json',
  'GET /api/health',
  'GET /api/ready',
  // Hono が route() の登録ごとに作る内部の総称経路。
  'ALL /api/*',
  'ALL /*',
]);

function registeredRoutes(): string[] {
  const app = createApp({
    db: createStubDatabase(),
    // カードの経路は指紋鍵がある構成でだけ有効になる。契約は両方の構成で同じ。
    cardFingerprintMasterKey: 'contract-test-card-fingerprint-master-key',
  });
  return [
    ...new Set(
      app.routes
        .filter((route) => typeof route.handler === 'function')
        .map((route) => `${route.method} ${route.path}`),
    ),
  ];
}

function contractRoutes(): string[] {
  return Object.values(operations).map(
    (operation) =>
      `${operation.method.toUpperCase()} ${API_BASE_PATH}${honoPath({ path: operation.path })}`,
  );
}

describe('経路と契約', () => {
  it('検査の対象が空でない', () => {
    // 経路も契約も読めていなければ、比較は素通りする。
    expect(registeredRoutes().length).toBeGreaterThan(50);
    expect(contractRoutes().length).toBeGreaterThan(50);
  });

  it('契約に無い経路を公開しない', () => {
    const contracted = new Set(contractRoutes());
    const extra = registeredRoutes().filter(
      (route) => !contracted.has(route) && !UNCONTRACTED.has(route),
    );

    expect(extra).toEqual([]);
  });

  it('契約にある操作はすべて経路として登録されている', () => {
    const registered = new Set(registeredRoutes());
    const missing = contractRoutes().filter((route) => !registered.has(route));

    expect(missing).toEqual([]);
  });
});
