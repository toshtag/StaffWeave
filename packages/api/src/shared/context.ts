import type { Permission } from '@staffweave/domain';
import { hasPermission } from '@staffweave/domain';
import type { Context } from 'hono';
import type { AuthenticatedContext } from '../identity/service.js';
import { forbidden, unauthenticated } from './errors.js';

/** Hono のコンテキストへ格納する値の型。 */
export interface AppEnv {
  Variables: {
    auth: AuthenticatedContext | null;
  };
}

export function currentAuth(c: Context<AppEnv>): AuthenticatedContext {
  const auth = c.get('auth');
  if (!auth) throw unauthenticated();
  return auth;
}

export function requirePermission(
  c: Context<AppEnv>,
  permission: Permission,
): AuthenticatedContext {
  const auth = currentAuth(c);
  if (!hasPermission(auth.roles, permission)) throw forbidden();
  return auth;
}
