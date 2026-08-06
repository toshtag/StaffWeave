import { getConnInfo } from '@hono/node-server/conninfo';
import type {
  ChangePasswordRequest,
  LoginRequest,
  ResetUserPasswordRequest,
  UpdatePreferencesRequest,
} from '@staffweave/contracts';
import {
  changePasswordRequestSchema,
  honoPath,
  loginRequestSchema,
  operations,
  resetUserPasswordRequestSchema,
  updatePreferencesRequestSchema,
} from '@staffweave/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { pathParam, readBody } from '../shared/request.js';
import type { IdentityService } from './service.js';
import { toSessionResponse } from './service.js';

export const SESSION_COOKIE_NAME = 'staffweave_session';

export interface IdentityRouteDependencies {
  service: IdentityService;
  /** 本番環境では Cookie に Secure を付ける。 */
  useSecureCookie: boolean;
  /**
   * 逆プロキシが付ける転送元の頭書き（`X-Forwarded-For`）を信用するか。
   *
   * 信用すると、送信元は要求の頭書きが決める。前段が値を上書きする構成でだけ有効にする。
   * 直接受ける構成で信用すると、送信元を自由に名乗れてしまい、数える意味がなくなる。
   */
  trustProxyForClientAddress: boolean;
}

/**
 * 失敗を数える単位としての送信元。
 *
 * 分からなければ `undefined` を返す。既定値へ丸めると、
 * 分からない要求どうしが同じ単位に入り、無関係な利用者を巻き込んで断ってしまう。
 */
function clientAddress(c: Context<AppEnv>, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    // 前段が付ける一覧の先頭が、前段から見た送信元。
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded === undefined || forwarded === '' ? undefined : forwarded;
  }

  try {
    const address = getConnInfo(c).remote.address;
    return address === undefined || address === '' ? undefined : address;
  } catch {
    // 接続の情報を取れない実行環境（テストの直接呼び出しなど）では数えない。
    return undefined;
  }
}

export function createIdentityRoutes(deps: IdentityRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(operations.login.path, async (c) => {
    const body = await readBody<LoginRequest>(c, loginRequestSchema);
    const source = clientAddress(c, deps.trustProxyForClientAddress);
    // 名乗りはここから先へ生のまま渡すが、保存する前に系統へ落とす。
    const userAgent = c.req.header('user-agent');
    const result = await deps.service.login({
      ...body,
      ...(source === undefined ? {} : { source }),
      ...(userAgent === undefined ? {} : { userAgent }),
    });

    // Cookie の保持期間は絶対期限に合わせる。
    // アイドル期限はサーバーが延ばすため、Cookie 側をそちらに合わせると、
    // 延長したセッションが残っているのにブラウザからは消える食い違いが起きる。
    // 絶対期限より先に断るかどうかは、引き続きサーバーが決める。
    setCookie(c, SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: deps.useSecureCookie,
      path: '/',
      expires: result.absoluteExpiresAt,
    });

    return c.json(toSessionResponse(result.context), 200);
  });

  app.post(operations.logout.path, async (c) => {
    await deps.service.logout(getCookie(c, SESSION_COOKIE_NAME));
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  app.get(operations.getSession.path, (c) => c.json(toSessionResponse(currentAuth(c)), 200));

  app.post(operations.changePassword.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<ChangePasswordRequest>(c, changePasswordRequestSchema);
    // 手元のセッションだけ残す。変更した本人をその場で締め出さない。
    await deps.service.changePassword(auth, body);
    return c.body(null, 204);
  });

  app.get(operations.listSessions.path, async (c) => {
    const sessions = await deps.service.listSessions(currentAuth(c));
    return c.json({ sessions }, 200);
  });

  app.delete(honoPath(operations.revokeSession), async (c) => {
    const auth = currentAuth(c);
    await deps.service.revokeSession(auth, pathParam(c, 'sessionId'));
    return c.body(null, 204);
  });

  app.post(honoPath(operations.revokeUserSessions), async (c) => {
    const auth = currentAuth(c);
    const revoked = await deps.service.revokeSessionsOfUser(auth, pathParam(c, 'userId'));
    return c.json({ revoked }, 200);
  });

  app.post(honoPath(operations.resetUserPassword), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<ResetUserPasswordRequest>(c, resetUserPasswordRequestSchema);
    const revoked = await deps.service.resetUserPassword(
      auth,
      pathParam(c, 'userId'),
      body.newPassword,
    );
    return c.json({ revoked }, 200);
  });

  app.post(operations.revokeOtherSessions.path, async (c) => {
    const revoked = await deps.service.revokeOtherSessions(currentAuth(c));
    return c.json({ revoked }, 200);
  });

  app.patch(operations.updatePreferences.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<UpdatePreferencesRequest>(c, updatePreferencesRequestSchema);
    const updated = await deps.service.updateLocale(auth, body.locale);
    c.set('auth', updated);
    return c.json(toSessionResponse(updated), 200);
  });

  return app;
}
