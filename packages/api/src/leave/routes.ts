import type {
  AdjustLeaveRequest,
  GrantLeaveRequest,
  ReverseLeaveEntryRequest,
  UpdateLeaveTypeRequest,
} from '@staffweave/contracts';
import {
  adjustLeaveRequestSchema,
  grantLeaveRequestSchema,
  honoPath,
  listLeaveBalancesQuerySchema,
  listLeaveLedgerQuerySchema,
  operations,
  reverseLeaveEntryRequestSchema,
  updateLeaveTypeRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { LeaveService } from './service.js';

export interface LeaveRouteDependencies {
  service: LeaveService;
}

export function createLeaveRoutes(deps: LeaveRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listLeaveTypeSettings.path, async (c) => {
    const auth = currentAuth(c);
    return c.json({ leaveTypes: await service.listLeaveTypes(auth) }, 200);
  });

  app.patch(honoPath(operations.updateLeaveType), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<UpdateLeaveTypeRequest>(c, updateLeaveTypeRequestSchema);
    return c.json(await service.updateLeaveType(auth, pathParam(c, 'leaveTypeId'), body), 200);
  });

  app.get(operations.listLeaveLedger.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId: string; leaveTypeId?: string }>(
      c,
      listLeaveLedgerQuerySchema,
    );
    return c.json({ entries: await service.listLedger(auth, query) }, 200);
  });

  app.get(operations.listLeaveBalances.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId: string; asOf?: string }>(c, listLeaveBalancesQuerySchema);
    return c.json({ balances: await service.listBalances(auth, query) }, 200);
  });

  app.post(operations.grantLeave.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<GrantLeaveRequest>(c, grantLeaveRequestSchema);
    return c.json(await service.grant(auth, body), 201);
  });

  app.post(operations.adjustLeave.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<AdjustLeaveRequest>(c, adjustLeaveRequestSchema);
    return c.json(await service.adjust(auth, body), 201);
  });

  app.post(honoPath(operations.reverseLeaveEntry), async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<ReverseLeaveEntryRequest>(c, reverseLeaveEntryRequestSchema);
    return c.json(await service.reverse(auth, pathParam(c, 'leaveLedgerEntryId'), body), 201);
  });

  return app;
}
