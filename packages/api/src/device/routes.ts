import type {
  DeviceEventRequest,
  EnrollDeviceRequest,
  RegisterDeviceRequest,
} from '@staffweave/contracts';
import {
  deviceEventRequestSchema,
  enrollDeviceRequestSchema,
  operations,
  registerDeviceRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { ApiError } from '../shared/errors.js';
import { readBody } from '../shared/request.js';
import type { DeviceService } from './service.js';

export const DEVICE_ID_HEADER = 'x-staffweave-device';
export const DEVICE_SIGNATURE_HEADER = 'x-staffweave-signature';

export interface DeviceRouteDependencies {
  service: DeviceService;
}

export function createDeviceRoutes(deps: DeviceRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listDevices.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ devices: await service.list(auth) }, 200);
  });

  app.post(operations.registerDevice.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<RegisterDeviceRequest>(c, registerDeviceRequestSchema);
    return c.json(await service.register(auth, body), 201);
  });

  app.post('/devices/:deviceId/revoke', async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    return c.json(await service.revoke(auth, c.req.param('deviceId')), 200);
  });

  app.get('/devices/:deviceId/receipts', async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ receipts: await service.listReceipts(auth, c.req.param('deviceId')) }, 200);
  });

  // Agent 向けの経路。セッションではなく端末の資格情報で認証する。
  app.post(operations.enrollDevice.path, async (c) => {
    const body = await readBody<EnrollDeviceRequest>(c, enrollDeviceRequestSchema);
    return c.json(await service.enroll(body), 200);
  });

  app.post(operations.recordDeviceEvent.path, async (c) => {
    const deviceId = c.req.header(DEVICE_ID_HEADER);
    const signature = c.req.header(DEVICE_SIGNATURE_HEADER);
    if (deviceId === undefined || signature === undefined) {
      throw new ApiError('unauthenticated', '端末を認証できません');
    }
    const body = await readBody<DeviceEventRequest>(c, deviceEventRequestSchema);
    const { result, created } = await service.recordEvent(deviceId, signature, body);
    return c.json(result, created ? 201 : 200);
  });

  return app;
}
