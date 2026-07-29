import type {
  CardEventRequest,
  CreateCardRegistrationRequest,
  RegisterCardRequest,
} from '@staffweave/contracts';
import {
  cardEventRequestSchema,
  createCardRegistrationRequestSchema,
  operations,
  registerCardRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import { DEVICE_ID_HEADER, DEVICE_SIGNATURE_HEADER } from '../device/routes.js';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { ApiError } from '../shared/errors.js';
import { readBody } from '../shared/request.js';
import type { CardService } from './service.js';

export interface CardRouteDependencies {
  service: CardService;
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

  app.post('/card-credentials/:cardCredentialId/revoke', async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    return c.json(await service.revokeCredential(auth, c.req.param('cardCredentialId')), 200);
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
