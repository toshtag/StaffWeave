import { describe, expect, it } from 'vitest';
import { recordingDatabase } from '../../test/support/fake-database.js';
import { createDeviceRepository } from './repository.js';

/**
 * 端末の有効化が「登録待ちの端末を、渡されたトークンで」だけ行われることを固定する。
 *
 * 事前の検索と更新が分かれていると、同じ登録トークンで同時に届いた要求が
 * どちらも検索を通り、いずれも登録を成立させられる。
 * 一度きりを決めるのは更新の条件であり、その条件が落ちても
 * 通常の登録は成功するため、テストで固定しておかないと気付けない。
 */

const deviceRow = {
  id: 'device-1',
  site_id: null,
  name: '入口の端末',
  state: 'active',
  enrollments: 1,
  last_sequence: 0,
  enrolled_at: new Date('2026-04-01T00:00:00.000Z'),
  revoked_at: null,
  last_seen_at: null,
  created_at: new Date('2026-03-31T00:00:00.000Z'),
};

const input = {
  enrollmentTokenHash: 'token-hash',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n',
  enrollments: 1,
  enrolledAt: new Date('2026-04-01T00:00:00.000Z'),
};

describe('markEnrolledIfPending', () => {
  it('登録待ちであることと渡されたトークンであることを更新の条件にする', async () => {
    const { queries, db } = recordingDatabase([deviceRow]);

    await createDeviceRepository(db).markEnrolledIfPending('workspace-1', 'device-1', input);

    const sql = queries[0]?.text ?? '';
    expect(sql).toMatch(/state = 'pending'/);
    expect(sql).toMatch(/public_key IS NULL/);
    expect(sql).toMatch(/enrollment_token_hash = \$3/);
    expect(sql).toMatch(/workspace_id = \$1/);
    expect(sql).toMatch(/\bid = \$2/);
    expect(sql).toMatch(/RETURNING/);
    expect(queries[0]?.params).toEqual([
      'workspace-1',
      'device-1',
      'token-hash',
      input.publicKey,
      1,
      input.enrolledAt,
    ]);
  });

  it('更新できた端末を返す', async () => {
    const { db } = recordingDatabase([deviceRow]);

    const device = await createDeviceRepository(db).markEnrolledIfPending(
      'workspace-1',
      'device-1',
      input,
    );

    expect(device?.state).toBe('active');
    expect(device?.enrollments).toBe(1);
  });

  it('更新できる行が無ければ競合として null を返す', async () => {
    const { db } = recordingDatabase([]);

    await expect(
      createDeviceRepository(db).markEnrolledIfPending('workspace-1', 'device-1', input),
    ).resolves.toBeNull();
  });
});
