import type { Queryable, QueryParameter } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createApprovalRepository } from './repository.js';

/**
 * 申請の一覧が、状態遷移を件数によらず 1 回で読むことを固定する。
 *
 * 申請ごとに引く形へ戻しても、応答の内容は変わらないため気付けない。
 * 変わるのは問い合わせの回数だけであり、それはここでしか確かめられない。
 */

interface RecordedQuery {
  text: string;
  params: readonly QueryParameter[];
}

interface RequestRow {
  id: string;
  employee_id: string;
  business_date: string;
  state: string;
  submissions: number;
  returns: number;
  submitted_at: Date | null;
  decided_at: Date | null;
  decided_by_user_id: string | null;
}

interface TransitionRow {
  request_id: string;
  from_state: string;
  to_state: string;
  event: string;
  actor_user_id: string | null;
  comment: string | null;
  occurred_at: Date;
}

function requestRow(id: string, businessDate: string): RequestRow {
  return {
    id,
    employee_id: 'employee-1',
    business_date: businessDate,
    state: 'submitted',
    submissions: 1,
    returns: 0,
    submitted_at: new Date('2026-04-01T00:00:00.000Z'),
    decided_at: null,
    decided_by_user_id: null,
  };
}

function transitionRow(requestId: string, event: string, occurredAt: string): TransitionRow {
  return {
    request_id: requestId,
    from_state: 'draft',
    to_state: 'submitted',
    event,
    actor_user_id: null,
    comment: null,
    occurred_at: new Date(occurredAt),
  };
}

/** 申請の問い合わせと遷移の問い合わせを、SQL の対象テーブルで振り分ける。 */
function recordingDatabase(
  requests: RequestRow[],
  transitions: TransitionRow[],
): { queries: RecordedQuery[]; db: Queryable } {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    db: {
      query: async <T = Record<string, unknown>>(
        text: string,
        params: readonly QueryParameter[] = [],
      ): Promise<T[]> => {
        queries.push({ text, params });
        return (text.includes('attendance_request_transitions') ? transitions : requests) as T[];
      },
    },
  };
}

const TRANSITION_QUERY = /attendance_request_transitions/;

describe('listRequests', () => {
  it('申請が何件あっても、遷移の問い合わせは 1 回だけ行う', async () => {
    const { queries, db } = recordingDatabase(
      [requestRow('request-1', '2026-04-01'), requestRow('request-2', '2026-04-02')],
      [
        transitionRow('request-1', 'SUBMIT', '2026-04-01T01:00:00.000Z'),
        transitionRow('request-2', 'SUBMIT', '2026-04-02T01:00:00.000Z'),
      ],
    );

    await createApprovalRepository(db).listRequests('workspace-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(queries).toHaveLength(2);
    expect(queries.filter((query) => TRANSITION_QUERY.test(query.text))).toHaveLength(1);
  });

  it('遷移をまとめて読むときは、対象の申請だけを条件にする', async () => {
    const { queries, db } = recordingDatabase(
      [requestRow('request-1', '2026-04-01'), requestRow('request-2', '2026-04-02')],
      [],
    );

    await createApprovalRepository(db).listRequests('workspace-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    const transitionQuery = queries.find((query) => TRANSITION_QUERY.test(query.text));
    expect(transitionQuery?.text).toMatch(/workspace_id = \$1/);
    expect(transitionQuery?.text).toMatch(/request_id = ANY\(\$2::uuid\[\]\)/);
    expect(transitionQuery?.params).toEqual(['workspace-1', ['request-1', 'request-2']]);
  });

  it('遷移を申請ごとに振り分け、読み出した順序を保つ', async () => {
    const { db } = recordingDatabase(
      [requestRow('request-1', '2026-04-01'), requestRow('request-2', '2026-04-02')],
      [
        transitionRow('request-1', 'SUBMIT', '2026-04-01T01:00:00.000Z'),
        transitionRow('request-2', 'SUBMIT', '2026-04-02T01:00:00.000Z'),
        transitionRow('request-1', 'RETURN', '2026-04-03T01:00:00.000Z'),
      ],
    );

    const requests = await createApprovalRepository(db).listRequests('workspace-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(requests[0]?.transitions.map((transition) => transition.event)).toEqual([
      'SUBMIT',
      'RETURN',
    ]);
    expect(requests[1]?.transitions.map((transition) => transition.event)).toEqual(['SUBMIT']);
  });

  it('遷移を持たない申請は空の配列を返す', async () => {
    const { db } = recordingDatabase([requestRow('request-1', '2026-04-01')], []);

    const requests = await createApprovalRepository(db).listRequests('workspace-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(requests[0]?.transitions).toEqual([]);
  });

  it('申請が 1 件も無ければ、遷移を問い合わせない', async () => {
    const { queries, db } = recordingDatabase([], []);

    const requests = await createApprovalRepository(db).listRequests('workspace-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(requests).toEqual([]);
    expect(queries.filter((query) => TRANSITION_QUERY.test(query.text))).toHaveLength(0);
  });
});
