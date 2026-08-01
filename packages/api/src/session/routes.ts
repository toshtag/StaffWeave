import type { JsonSchema, RecordSessionObservationsRequest } from '@staffweave/contracts';
import {
  honoPath,
  listSessionObservationsQuerySchema,
  operations,
  recordSessionObservationsRequestSchema,
  validate,
} from '@staffweave/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { DEVICE_ID_HEADER, DEVICE_SIGNATURE_HEADER } from '../device/routes.js';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { ApiError, invalidRequest } from '../shared/errors.js';
import { pathParam, readBody } from '../shared/request.js';
import type { SessionService } from './service.js';

export interface SessionRouteDependencies {
  service: SessionService;
}

function readQuery<T>(c: Context<AppEnv>, schema: JsonSchema): T {
  const result = validate<T>(schema, Object.fromEntries(new URL(c.req.url).searchParams));
  if (!result.valid) throw invalidRequest(result.problems);
  return result.value;
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
    const employeeId = new URL(c.req.url).searchParams.get('employeeId') ?? undefined;
    return c.json(
      await service.getDiscrepancyReport(auth, pathParam(c, 'businessDate'), employeeId),
      200,
    );
  });

  return app;
}
