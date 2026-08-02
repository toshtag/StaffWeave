import type { RecordSessionObservationsRequest } from '@staffweave/contracts';
import {
  getDiscrepancyReportQuerySchema,
  honoPath,
  listSessionObservationsQuerySchema,
  operations,
  recordSessionObservationsRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import { DEVICE_ID_HEADER, DEVICE_SIGNATURE_HEADER } from '../device/routes.js';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { ApiError } from '../shared/errors.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { SessionService } from './service.js';

export interface SessionRouteDependencies {
  service: SessionService;
}

export function createSessionRoutes(deps: SessionRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.post(operations.recordSessionObservations.path, async (c) => {
    const deviceId = c.req.header(DEVICE_ID_HEADER);
    const signature = c.req.header(DEVICE_SIGNATURE_HEADER);
    if (deviceId === undefined || signature === undefined) {
      throw new ApiError('unauthenticated', '端末を認証できません');
    }
    const body = await readBody<RecordSessionObservationsRequest>(
      c,
      recordSessionObservationsRequestSchema,
    );
    const { result, created } = await service.recordObservations(deviceId, signature, body);
    return c.json(result, created ? 201 : 200);
  });

  app.get(operations.listSessionObservations.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; from: string; to: string }>(
      c,
      listSessionObservationsQuerySchema,
    );
    return c.json({ observations: await service.listObservations(auth, query) }, 200);
  });

  app.get(honoPath(operations.getDiscrepancyReport), async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string }>(c, getDiscrepancyReportQuerySchema);
    return c.json(
      await service.getDiscrepancyReport(auth, pathParam(c, 'businessDate'), query.employeeId),
      200,
    );
  });

  return app;
}
