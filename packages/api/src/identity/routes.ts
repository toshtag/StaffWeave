import type { LoginRequest, UpdatePreferencesRequest } from '@staffweave/contracts';
import {
  loginRequestSchema,
  operations,
  updatePreferencesRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { readBody } from '../shared/request.js';
import type { IdentityService } from './service.js';
import { toSessionResponse } from './service.js';

export const SESSION_COOKIE_NAME = 'staffweave_session';

export interface IdentityRouteDependencies {
  service: IdentityService;
  /** 本番環境では Cookie に Secure を付ける。 */
  useSecureCookie: boolean;
}

export function createIdentityRoutes(deps: IdentityRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(operations.login.path, async (c) => {
    const body = await readBody<LoginRequest>(c, loginRequestSchema);
    const result = await deps.service.login(body);

    setCookie(c, SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: deps.useSecureCookie,
      path: '/',
      expires: result.expiresAt,
    });

    return c.json(toSessionResponse(result.context), 200);
  });

  app.post(operations.logout.path, async (c) => {
    await deps.service.logout(getCookie(c, SESSION_COOKIE_NAME));
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  app.get(operations.getSession.path, (c) => c.json(toSessionResponse(currentAuth(c)), 200));

  app.patch(operations.updatePreferences.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<UpdatePreferencesRequest>(c, updatePreferencesRequestSchema);
    const updated = await deps.service.updateLocale(auth, body.locale);
    c.set('auth', updated);
    return c.json(toSessionResponse(updated), 200);
  });

  return app;
}
