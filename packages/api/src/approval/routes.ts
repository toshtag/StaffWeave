import type {
  CloseMonthRequest,
  DecideDailyRequestRequest,
  JsonSchema,
  ReopenMonthRequest,
  SubmitDailyRequestRequest,
} from '@staffweave/contracts';
import {
  closeMonthRequestSchema,
  decideDailyRequestRequestSchema,
  honoPath,
  listDailyRequestsQuerySchema,
  listMonthlyClosingsQuerySchema,
  operations,
  reopenMonthRequestSchema,
  submitDailyRequestRequestSchema,
  validate,
} from '@staffweave/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { invalidRequest } from '../shared/errors.js';
import { pathParam, readBody } from '../shared/request.js';
import type { ApprovalService } from './service.js';

export interface ApprovalRouteDependencies {
  service: ApprovalService;
}

function readQuery<T>(c: Context<AppEnv>, schema: JsonSchema): T {
  const result = validate<T>(schema, Object.fromEntries(new URL(c.req.url).searchParams));
  if (!result.valid) throw invalidRequest(result.problems);
  return result.value;
}

export function createApprovalRoutes(deps: ApprovalRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.post(operations.submitDailyRequest.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<SubmitDailyRequestRequest>(c, submitDailyRequestRequestSchema);
    return c.json(await service.submit(auth, body), 200);
  });

  app.get(operations.listDailyRequests.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; from: string; to: string; state?: string }>(
      c,
      listDailyRequestsQuerySchema,
    );
    return c.json({ requests: await service.listRequests(auth, query) }, 200);
  });

  app.post(honoPath(operations.approveDailyRequest), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<DecideDailyRequestRequest>(c, decideDailyRequestRequestSchema);
    return c.json(await service.decide(auth, pathParam(c, 'requestId'), 'APPROVE', body), 200);
  });

  app.post(honoPath(operations.returnDailyRequest), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<DecideDailyRequestRequest>(c, decideDailyRequestRequestSchema);
    return c.json(await service.decide(auth, pathParam(c, 'requestId'), 'RETURN', body), 200);
  });

  app.post(honoPath(operations.cancelDailyRequest), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<DecideDailyRequestRequest>(c, decideDailyRequestRequestSchema);
    return c.json(await service.decide(auth, pathParam(c, 'requestId'), 'CANCEL', body), 200);
  });

  app.get(operations.listMonthlyClosings.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; from: string; to: string }>(
      c,
      listMonthlyClosingsQuerySchema,
    );
    return c.json({ closings: await service.listClosings(auth, query) }, 200);
  });

  app.post(operations.closeMonth.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<CloseMonthRequest>(c, closeMonthRequestSchema);
    return c.json(await service.close(auth, body), 200);
  });

  app.post(operations.reopenMonth.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<ReopenMonthRequest>(c, reopenMonthRequestSchema);
    return c.json(await service.reopen(auth, body), 200);
  });

  return app;
}
