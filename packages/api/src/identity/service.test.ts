import type { Queryable } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { onlyReads, recordingDatabase } from '../../test/support/fake-database.js';
import { silentLogger } from '../shared/logger.js';
import type { LoginAttemptRepository } from './login-attempt-repository.js';
import { createIdentityRepository } from './repository.js';
import { createIdentityService } from './service.js';

/**
 * 要求ごとに通る認証が、何回問い合わせるかを固定する。
 *
 * 復元した内容が同じであれば、分けて引いても応答は変わらない。
 * 変わるのは往復の回数だけであり、それはここでしか確かめられない。
 */

const ISSUED_AT = new Date('2026-04-01T00:00:00.000Z');
/** 既定の有効期間は 12 時間。 */
const EXPIRES_AT = new Date('2026-04-01T12:00:00.000Z');
/** 発行から 6 時間以内は延長しない。 */
const BEFORE_RENEWAL = new Date('2026-04-01T01:00:00.000Z');
const AFTER_RENEWAL = new Date('2026-04-01T07:00:00.000Z');

function contextRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-1',
    workspace_id: 'workspace-1',
    user_id: 'user-1',
    issued_at: ISSUED_AT,
    expires_at: EXPIRES_AT,
    revoked_at: null,
    slug: 'default',
    workspace_name: '既定',
    time_zone: 'Asia/Tokyo',
    email: 'admin@example.com',
    password_hash: 'hash',
    user_display_name: '管理 太郎',
    locale: 'ja-JP',
    status: 'active',
    employee_id: null,
    employee_number: null,
    employee_display_name: null,
    organization_id: null,
    roles: ['workspace_admin'],
    organization_ids: [],
    ...overrides,
  };
}

/** ログインの経路は使わないため、数える先は呼ばれない前提で置く。 */
const unusedLoginAttempts: LoginAttemptRepository = {
  find: async () => null,
  save: async () => {},
  clear: async () => {},
  purgeOlderThan: async () => 0,
};

function service(db: Queryable, now: Date) {
  return createIdentityService({
    repository: createIdentityRepository(db),
    now: () => now,
    defaultWorkspaceSlug: 'default',
    loginAttempts: unusedLoginAttempts,
    loginAttemptPolicy: {
      account: { maxFailures: 5, windowMs: 900_000, blockMs: 900_000 },
      source: { maxFailures: 50, windowMs: 900_000, blockMs: 900_000 },
    },
    logger: silentLogger,
  });
}

describe('authenticate', () => {
  it('延長が要らない要求では 1 回だけ問い合わせる', async () => {
    const { queries, db } = recordingDatabase(onlyReads([contextRow()]));

    await service(db, BEFORE_RENEWAL).authenticate('token');

    expect(queries).toHaveLength(1);
  });

  it('延長が要る要求でも、読み取りは 1 回で済ませる', async () => {
    const { queries, db } = recordingDatabase(onlyReads([contextRow()]));

    await service(db, AFTER_RENEWAL).authenticate('token');

    expect(queries).toHaveLength(2);
    expect(queries[1]?.text).toMatch(/UPDATE sessions/);
  });

  it('ロール・閲覧範囲・従業員の紐づけを、同じ問い合わせから復元する', async () => {
    const { db } = recordingDatabase(
      onlyReads([
        contextRow({
          roles: ['employee', 'organization_manager'],
          organization_ids: ['organization-1', 'organization-2'],
          employee_id: 'employee-1',
          employee_number: 'E001',
          employee_display_name: '勤怠 花子',
          organization_id: 'organization-1',
        }),
      ]),
    );

    const context = await service(db, BEFORE_RENEWAL).authenticate('token');

    expect(context?.roles).toEqual(['employee', 'organization_manager']);
    expect(context?.organizationScopes).toEqual(['organization-1', 'organization-2']);
    expect(context?.employee).toEqual({
      id: 'employee-1',
      employeeNumber: 'E001',
      displayName: '勤怠 花子',
      organizationId: 'organization-1',
    });
    expect(context?.workspace.timeZone).toBe('Asia/Tokyo');
    expect(context?.sessionExpiresAt).toEqual(EXPIRES_AT);
  });

  it('従業員に紐づかない利用者では employee が null になる', async () => {
    const { db } = recordingDatabase(onlyReads([contextRow()]));

    const context = await service(db, BEFORE_RENEWAL).authenticate('token');

    expect(context?.employee).toBeNull();
    expect(context?.organizationScopes).toEqual([]);
  });

  it('停止中の利用者は認証しない', async () => {
    const { db } = recordingDatabase(onlyReads([contextRow({ status: 'suspended' })]));

    await expect(service(db, BEFORE_RENEWAL).authenticate('token')).resolves.toBeNull();
  });

  it('失効したセッションは認証しない', async () => {
    const { db } = recordingDatabase(
      onlyReads([contextRow({ revoked_at: new Date('2026-04-01T00:30:00.000Z') })]),
    );

    await expect(service(db, BEFORE_RENEWAL).authenticate('token')).resolves.toBeNull();
  });

  it('有効期限を過ぎたセッションは認証せず、延長もしない', async () => {
    const { queries, db } = recordingDatabase(onlyReads([contextRow()]));

    const context = await service(db, new Date('2026-04-01T13:00:00.000Z')).authenticate('token');

    expect(context).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('Cookie が無ければ問い合わせない', async () => {
    const { queries, db } = recordingDatabase(onlyReads([contextRow()]));

    await expect(service(db, BEFORE_RENEWAL).authenticate(undefined)).resolves.toBeNull();
    expect(queries).toHaveLength(0);
  });
});
