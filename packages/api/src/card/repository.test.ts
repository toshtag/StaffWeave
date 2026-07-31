import type { Queryable, QueryParameter } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createCardRepository } from './repository.js';

/**
 * 登録トークンの消費が「未使用かつ有効期限内」だけで成立することを固定する。
 *
 * 事前の検査と更新が分かれていると、同じ登録トークンで同時に届いた要求が
 * どちらも検査を通り、いずれもカードを登録できる。
 * 一度きりを決めるのは更新の条件であり、その条件が落ちても
 * 通常の登録は成功するため、テストで固定しておかないと気付けない。
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

const USED_AT = new Date('2026-04-01T00:00:00.000Z');

describe('markRegistrationTokenUsedIfAvailable', () => {
  it('未使用であることと有効期限内であることを更新の条件にする', async () => {
    const { queries, db } = recordingDatabase([{ id: 'token-1' }]);

    await createCardRepository(db).markRegistrationTokenUsedIfAvailable(
      'workspace-1',
      'token-1',
      USED_AT,
    );

    const sql = queries[0]?.text ?? '';
    expect(sql).toMatch(/used_at IS NULL/);
    expect(sql).toMatch(/expires_at > \$3/);
    expect(sql).toMatch(/workspace_id = \$1/);
    expect(sql).toMatch(/\bid = \$2/);
    expect(sql).toMatch(/RETURNING id/);
    expect(queries[0]?.params).toEqual(['workspace-1', 'token-1', USED_AT]);
  });

  it('消費できた場合だけ true を返す', async () => {
    const { db } = recordingDatabase([{ id: 'token-1' }]);

    await expect(
      createCardRepository(db).markRegistrationTokenUsedIfAvailable(
        'workspace-1',
        'token-1',
        USED_AT,
      ),
    ).resolves.toBe(true);
  });

  it('更新できる行が無ければ競合として false を返す', async () => {
    const { db } = recordingDatabase([]);

    await expect(
      createCardRepository(db).markRegistrationTokenUsedIfAvailable(
        'workspace-1',
        'token-1',
        USED_AT,
      ),
    ).resolves.toBe(false);
  });
});
