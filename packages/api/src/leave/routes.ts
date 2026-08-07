import type {
  AdjustLeaveRequest,
  CreateLeaveGrantRuleRequest,
  GrantLeaveInBulkRequest,
  GrantLeaveRequest,
  ReverseLeaveEntryRequest,
  UpdateLeaveTypeRequest,
} from '@staffweave/contracts';
import {
  adjustLeaveRequestSchema,
  createLeaveGrantRuleRequestSchema,
  grantLeaveInBulkRequestSchema,
  grantLeaveRequestSchema,
  honoPath,
  listLeaveBalancesQuerySchema,
  listLeaveExpirationsQuerySchema,
  listLeaveGrantRulesQuerySchema,
  listLeaveLedgerQuerySchema,
  listLeaveRegisterQuerySchema,
  operations,
  reverseLeaveEntryRequestSchema,
  updateLeaveTypeRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { LeaveGrantService } from './grant-service.js';
import type { LeaveService } from './service.js';

export interface LeaveRouteDependencies {
  service: LeaveService;
  grants: LeaveGrantService;
}

export function createLeaveRoutes(deps: LeaveRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service, grants } = deps;

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

  app.get(operations.listLeaveGrantRules.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ leaveTypeId?: string }>(c, listLeaveGrantRulesQuerySchema);
    return c.json({ leaveGrantRules: await grants.listRules(auth, query.leaveTypeId) }, 200);
  });

  app.post(operations.createLeaveGrantRule.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<CreateLeaveGrantRuleRequest>(c, createLeaveGrantRuleRequestSchema);
    return c.json(await grants.createRule(auth, body), 201);
  });

  app.post(operations.grantLeaveInBulk.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<GrantLeaveInBulkRequest>(c, grantLeaveInBulkRequestSchema);
    return c.json(await grants.grantInBulk(auth, body), 200);
  });

  app.post(operations.importLeaveGrantsCsv.path, async (c) => {
    const auth = currentAuth(c);
    // 本文は CSV そのもの。契約の検証は列の見出しと行ごとに行う。
    return c.json(await grants.importCsv(auth, await c.req.text()), 200);
  });

  app.get(operations.listLeaveExpirations.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ asOf: string; through: string; employeeId?: string }>(
      c,
      listLeaveExpirationsQuerySchema,
    );
    return c.json({ expirations: await grants.listExpirations(auth, query) }, 200);
  });

  app.get(operations.listLeaveRegister.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ from: string; to: string; employeeId?: string }>(
      c,
      listLeaveRegisterQuerySchema,
    );
    return c.json({ register: await grants.listRegister(auth, query) }, 200);
  });

  return app;
}
