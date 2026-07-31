import type { Queryable, QueryParameter } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createIntegrationRepository } from './repository.js';

/**
 * 署名鍵をどの問い合わせが取得するかを固定する。
 *
 * 送信待ちを積むのは承認・締め・解除の業務トランザクションで、署名は行わない。
 * ここで鍵まで読むと、例外やトレースを通じて送信経路の外へ伝わる余地が残る。
 * 取得は送信の直前、ワーカーの `claimNext()` だけに限る。
 */

interface RecordedQuery {
  text: string;
  params: readonly QueryParameter[];
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
        return rows as T[];
      },
    },
  };
}

describe('listActiveEndpointIdsFor', () => {
  it('送信待ち登録用の問い合わせでは署名鍵を取得しない', async () => {
    const { queries, db } = recordingDatabase([{ id: 'endpoint-1' }]);

    await expect(
      createIntegrationRepository(db).listActiveEndpointIdsFor(
        'workspace-1',
        'attendance_request.approved',
      ),
    ).resolves.toEqual(['endpoint-1']);

    expect(queries).toHaveLength(1);
    const sql = queries[0]?.text ?? '';
    expect(sql).toMatch(/SELECT\s+id\b/i);
    expect(sql).not.toMatch(/signing_key/i);
    expect(sql).not.toMatch(/\burl\b/i);
  });

  it('Workspace と稼働状態と種別で絞る', async () => {
    const { queries, db } = recordingDatabase([]);

    await createIntegrationRepository(db).listActiveEndpointIdsFor(
      'workspace-1',
      'monthly_closing.closed',
    );

    const query = queries[0];
    expect(query?.text).toMatch(/workspace_id = \$1/);
    expect(query?.text).toMatch(/\bactive\b/);
    expect(query?.text).toMatch(/\$2 = ANY\(event_types\)/);
    expect(query?.params).toEqual(['workspace-1', 'monthly_closing.closed']);
  });
});
