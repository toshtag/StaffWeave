import type { Queryable, QueryParameter } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createIntegrationRepository } from './repository.js';
import { createIntegrationService } from './service.js';

/**
 * API キーの認証が、最後に使った時刻をいつ書くかを固定する。
 *
 * 要求のたびに書いても応答は変わらない。変わるのは、読み取りだけの要求が
 * 書き込みを伴うかどうかであり、それはここでしか確かめられない。
 */

interface RecordedQuery {
  text: string;
  params: readonly QueryParameter[];
}

const NOW = new Date('2026-04-01T00:00:00.000Z');
const INTERVAL_MS = 60_000;

function principalRow(lastUsedAt: Date | null): Record<string, unknown> {
  return {
    id: 'api-key-1',
    workspace_id: 'workspace-1',
    scopes: ['payroll:read'],
    last_used_at: lastUsedAt,
  };
}

function recordingDatabase(rows: Record<string, unknown>[]): {
  queries: RecordedQuery[];
  db: Queryable;
} {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    db: {
      query: async <T = Record<string, unknown>>(
        text: string,
        params: readonly QueryParameter[] = [],
      ): Promise<T[]> => {
        queries.push({ text, params });
        return (text.trimStart().startsWith('SELECT') ? rows : []) as T[];
      },
    },
  };
}

function service(db: Queryable) {
  return createIntegrationService({
    repository: createIntegrationRepository(db),
    now: () => NOW,
    webhookTarget: async (url) => ({ canonicalUrl: url }),
    apiKeyUsageIntervalMs: INTERVAL_MS,
  });
}

const UPDATE_QUERY = /UPDATE api_keys/;

describe('API キーの認証', () => {
  it('間隔の中で使われたキーでは、最後に使った時刻を書かない', async () => {
    const { queries, db } = recordingDatabase([principalRow(new Date(NOW.getTime() - 30_000))]);

    const principal = await service(db).authenticate('Bearer secret');

    expect(principal).toEqual({ workspaceId: 'workspace-1', scopes: ['payroll:read'] });
    expect(queries).toHaveLength(1);
    expect(queries.filter((query) => UPDATE_QUERY.test(query.text))).toHaveLength(0);
  });

  it('間隔を過ぎたキーでは、最後に使った時刻を書く', async () => {
    const { queries, db } = recordingDatabase([principalRow(new Date(NOW.getTime() - 5 * 60_000))]);

    await service(db).authenticate('Bearer secret');

    expect(queries).toHaveLength(2);
    expect(queries[1]?.text).toMatch(UPDATE_QUERY);
  });

  it('一度も使われていないキーでは、最後に使った時刻を書く', async () => {
    const { queries, db } = recordingDatabase([principalRow(null)]);

    await service(db).authenticate('Bearer secret');

    expect(queries).toHaveLength(2);
  });

  it('書き直しは、より新しい記録がある行を更新しない', async () => {
    const { queries, db } = recordingDatabase([principalRow(null)]);

    await service(db).authenticate('Bearer secret');

    const update = queries[1];
    expect(update?.text).toMatch(/last_used_at IS NULL OR last_used_at < \$3/);
    expect(update?.params).toEqual(['api-key-1', NOW, new Date(NOW.getTime() - INTERVAL_MS)]);
  });

  it('見つからないキーでは何も書かない', async () => {
    const { queries, db } = recordingDatabase([]);

    await expect(service(db).authenticate('Bearer secret')).resolves.toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('Bearer でない頭書きでは問い合わせない', async () => {
    const { queries, db } = recordingDatabase([principalRow(null)]);

    await expect(service(db).authenticate('Basic secret')).resolves.toBeNull();
    expect(queries).toHaveLength(0);
  });
});
