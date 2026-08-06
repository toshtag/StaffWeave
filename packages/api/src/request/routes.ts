import type {
  CreateRequestTypeRequest,
  DecideEmployeeRequestRequest,
  EmployeeRequestRecord,
  ResubmitEmployeeRequestRequest,
  SubmitEmployeeRequestRequest,
  UpdateRequestTypeRequest,
} from '@staffweave/contracts';
import {
  createRequestTypeRequestSchema,
  decideEmployeeRequestRequestSchema,
  honoPath,
  listEmployeeRequestsQuerySchema,
  operations,
  resubmitEmployeeRequestRequestSchema,
  submitEmployeeRequestRequestSchema,
  updateRequestTypeRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { RequestService } from './service.js';

export interface RequestRouteDependencies {
  service: RequestService;
}

export function createRequestRoutes(deps: RequestRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listRequestTypes.path, async (c) => {
    const auth = currentAuth(c);
    return c.json({ requestTypes: await service.listTypes(auth) }, 200);
  });

  app.post(operations.createRequestType.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<CreateRequestTypeRequest>(c, createRequestTypeRequestSchema);
    return c.json(await service.createType(auth, body), 201);
  });

  app.patch(honoPath(operations.updateRequestType), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<UpdateRequestTypeRequest>(c, updateRequestTypeRequestSchema);
    return c.json(await service.updateType(auth, pathParam(c, 'requestTypeId'), body), 200);
  });

  app.get(operations.listEmployeeRequests.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{
      employeeId?: string;
      state?: EmployeeRequestRecord['state'];
      from?: string;
      to?: string;
    }>(c, listEmployeeRequestsQuerySchema);
    return c.json({ requests: await service.list(auth, query) }, 200);
  });

  app.post(operations.submitEmployeeRequest.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<SubmitEmployeeRequestRequest>(
      c,
      submitEmployeeRequestRequestSchema,
    );
    return c.json(await service.submit(auth, body), 201);
  });

  app.post(honoPath(operations.decideEmployeeRequest), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<DecideEmployeeRequestRequest>(
      c,
      decideEmployeeRequestRequestSchema,
    );
    return c.json(await service.decide(auth, pathParam(c, 'employeeRequestId'), body), 200);
  });

  app.post(honoPath(operations.resubmitEmployeeRequest), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<ResubmitEmployeeRequestRequest>(
      c,
      resubmitEmployeeRequestRequestSchema,
    );
    return c.json(await service.resubmit(auth, pathParam(c, 'employeeRequestId'), body), 200);
  });

  app.post(honoPath(operations.cancelEmployeeRequest), async (c) => {
    const auth = currentAuth(c);
    return c.json(await service.cancel(auth, pathParam(c, 'employeeRequestId')), 200);
  });

  return app;
}
