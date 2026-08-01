import type {
  CardEventRequest,
  CreateCardRegistrationRequest,
  RegisterCardRequest,
} from '@staffweave/contracts';
import {
  cardEventRequestSchema,
  createCardRegistrationRequestSchema,
  honoPath,
  operations,
  registerCardRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import { DEVICE_ID_HEADER, DEVICE_SIGNATURE_HEADER } from '../device/routes.js';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { ApiError } from '../shared/errors.js';
import { pathParam, readBody } from '../shared/request.js';
import type { CardService } from './service.js';

export interface CardRouteDependencies {
  service: CardService;
}

/** 失効は経路に識別子を含むため、OpenAPI の表記ではなく Hono の書き方で持つ。 */
const CARD_REVOKE_PATH = honoPath(operations.revokeCardCredential);

/** カードの経路。有効なときと無効なときで同じ組を扱えるよう、一箇所に並べる。 */
const CARD_PATHS = [
  operations.listCardCredentials.path,
  operations.createCardRegistration.path,
  CARD_REVOKE_PATH,
  operations.registerCard.path,
  operations.recordCardEvent.path,
] as const;

/**
 * 指紋鍵が設定されていない構成のカードの経路。
 *
 * 経路そのものを外すと、利用者からは「この API は無い」と「設定が足りない」を
 * 区別できない。同じ 404 でも理由を返し、鍵なしの指紋は受け取らない。
 */
export function createDisabledCardRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  for (const path of CARD_PATHS) {
    app.all(path, () => {
      throw new ApiError('not_found', 'IC カード機能は設定されていません');
    });
  }
  return app;
}

export function createCardRoutes(deps: CardRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listCardCredentials.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    return c.json({ cardCredentials: await service.listCredentials(auth) }, 200);
  });

  app.post(operations.createCardRegistration.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<CreateCardRegistrationRequest>(
      c,
      createCardRegistrationRequestSchema,
    );
    return c.json(await service.createRegistration(auth, body), 201);
  });

  app.post(CARD_REVOKE_PATH, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    return c.json(await service.revokeCredential(auth, pathParam(c, 'cardCredentialId')), 200);
  });

  app.post(operations.registerCard.path, async (c) => {
    const { deviceId, signature } = requireDeviceHeaders(c.req.header.bind(c.req));
    const body = await readBody<RegisterCardRequest>(c, registerCardRequestSchema);
    return c.json(await service.registerCard(deviceId, signature, body), 201);
  });

  app.post(operations.recordCardEvent.path, async (c) => {
    const { deviceId, signature } = requireDeviceHeaders(c.req.header.bind(c.req));
    const body = await readBody<CardEventRequest>(c, cardEventRequestSchema);
    const { result, created } = await service.recordCardEvent(deviceId, signature, body);
    return c.json(result, created ? 201 : 200);
  });

  return app;
}

function requireDeviceHeaders(header: (name: string) => string | undefined): {
  deviceId: string;
  signature: string;
} {
  const deviceId = header(DEVICE_ID_HEADER);
  const signature = header(DEVICE_SIGNATURE_HEADER);
  if (deviceId === undefined || signature === undefined) {
    throw new ApiError('unauthenticated', '端末を認証できません');
  }
  return { deviceId, signature };
}
