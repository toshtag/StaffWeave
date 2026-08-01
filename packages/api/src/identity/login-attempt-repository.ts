import type { Queryable } from '@staffweave/db';
import type { LoginAttemptState } from '@staffweave/domain';
import { hashToken } from '../shared/security/tokens.js';

/**
 * ログインの失敗の回数。
 *
 * 数える単位は 2 つ。`account` は特定の利用者への総当たりを、
 * `source` は多数の利用者へ少しずつ試す形を止める。
 *
 * 識別子はそのまま保存せず、ハッシュで持つ。数えるために要るのは同一性だけで、
 * 元の値（メールアドレス・送信元アドレス）は要らない。
 */

export type LoginAttemptScope = 'account' | 'source';

export interface LoginAttemptRepository {
  find(scope: LoginAttemptScope, key: string): Promise<LoginAttemptState | null>;
  save(scope: LoginAttemptScope, key: string, state: LoginAttemptState): Promise<void>;
  clear(scope: LoginAttemptScope, key: string): Promise<void>;
  /** 更新が途絶えて久しい行を捨てる。窓も断りも過ぎた行は残しても意味がない。 */
  purgeOlderThan(threshold: Date): Promise<number>;
}

interface AttemptRow {
  failures: number;
  window_started_at: Date;
  blocked_until: Date | null;
}

export function createLoginAttemptRepository(db: Queryable): LoginAttemptRepository {
  return {
    async find(scope, key) {
      const rows = await db.query<AttemptRow>(
        `SELECT failures, window_started_at, blocked_until
           FROM login_attempts WHERE scope = $1 AND key_hash = $2`,
        [scope, hashToken(key)],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        failures: row.failures,
        windowStartedAt: row.window_started_at,
        blockedUntil: row.blocked_until,
      };
    },

    async save(scope, key, state) {
      await db.query(
        `INSERT INTO login_attempts
           (scope, key_hash, failures, window_started_at, blocked_until, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (scope, key_hash) DO UPDATE
            SET failures = excluded.failures,
                window_started_at = excluded.window_started_at,
                blocked_until = excluded.blocked_until,
                updated_at = now()`,
        [scope, hashToken(key), state.failures, state.windowStartedAt, state.blockedUntil],
      );
    },

    async clear(scope, key) {
      await db.query('DELETE FROM login_attempts WHERE scope = $1 AND key_hash = $2', [
        scope,
        hashToken(key),
      ]);
    },

    async purgeOlderThan(threshold) {
      const rows = await db.query<{ id: string }>(
        'DELETE FROM login_attempts WHERE updated_at < $1 RETURNING key_hash AS id',
        [threshold],
      );
      return rows.length;
    },
  };
}
