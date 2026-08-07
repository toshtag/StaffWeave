import type {
  CreateApprovalDelegationRequest,
  CreateRequestTypeRequest,
  DecideEmployeeRequestRequest,
  EmployeeRequestRecord,
  ReplaceApprovalRouteRequest,
  ResubmitEmployeeRequestRequest,
  SubmitEmployeeRequestRequest,
  UpdateRequestTypeRequest,
} from '@staffweave/contracts';
import {
  createApprovalDelegationRequestSchema,
  createRequestTypeRequestSchema,
  decideEmployeeRequestRequestSchema,
  honoPath,
  listEmployeeRequestsQuerySchema,
  operations,
  replaceApprovalRouteRequestSchema,
  resubmitEmployeeRequestRequestSchema,
  submitEmployeeRequestRequestSchema,
  updateRequestTypeRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { SettingsImportService } from '../schedule/settings-import.js';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { RequestService } from './service.js';

export interface RequestRouteDependencies {
  service: RequestService;
  imports: SettingsImportService;
}

export function createRequestRoutes(deps: RequestRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(operations.importRequestTypesCsv.path, async (c) => {
    const auth = currentAuth(c);
    return c.json(await deps.imports.importRequestTypes(auth, await c.req.text()), 200);
  });
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

  app.get(honoPath(operations.getApprovalRoute), async (c) => {
    const auth = currentAuth(c);
    return c.json(await service.getRoute(auth, pathParam(c, 'requestTypeId')), 200);
  });

  app.put(honoPath(operations.replaceApprovalRoute), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<ReplaceApprovalRouteRequest>(c, replaceApprovalRouteRequestSchema);
    return c.json(await service.replaceRoute(auth, pathParam(c, 'requestTypeId'), body), 200);
  });

  app.get(operations.listApprovalDelegations.path, async (c) => {
    const auth = currentAuth(c);
    return c.json({ delegations: await service.listDelegations(auth) }, 200);
  });

  app.post(operations.createApprovalDelegation.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<CreateApprovalDelegationRequest>(
      c,
      createApprovalDelegationRequestSchema,
    );
    return c.json(await service.createDelegation(auth, body), 201);
  });

  app.get(operations.listEmployeeRequests.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{
      employeeId?: string;
      state?: EmployeeRequestRecord['state'];
      from?: string;
      to?: string;
      awaitingMe?: 'true';
    }>(c, listEmployeeRequestsQuerySchema);
    // 問い合わせ文字列は文字しか運べない。真偽として受け取り直す。
    const { awaitingMe, ...rest } = query;
    return c.json(
      { requests: await service.list(auth, { ...rest, awaitingMe: awaitingMe === 'true' }) },
      200,
    );
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
