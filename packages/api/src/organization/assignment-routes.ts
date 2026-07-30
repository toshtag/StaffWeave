import type {
  CreateAssignmentContractRequest,
  CreateEmployeeAssignmentRequest,
  GrantUserScopeRequest,
} from '@staffweave/contracts';
import {
  createAssignmentContractRequestSchema,
  createEmployeeAssignmentRequestSchema,
  grantUserScopeRequestSchema,
  operations,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { readBody } from '../shared/request.js';
import type { AssignmentService } from './assignment-service.js';

export interface AssignmentRouteDependencies {
  service: AssignmentService;
}

export function createAssignmentRoutes(deps: AssignmentRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listAssignmentContracts.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ contracts: await service.listContracts(auth.workspace.id) }, 200);
  });

  app.post(operations.createAssignmentContract.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateAssignmentContractRequest>(
      c,
      createAssignmentContractRequestSchema,
    );
    return c.json(await service.createContract(auth.workspace.id, body), 201);
  });

  app.get(operations.listEmployeeAssignments.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    return c.json({ assignments: await service.listAssignments(auth) }, 200);
  });

  app.post(operations.createEmployeeAssignment.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<CreateEmployeeAssignmentRequest>(
      c,
      createEmployeeAssignmentRequestSchema,
    );
    return c.json(await service.createAssignment(auth.workspace.id, body), 201);
  });

  app.get(operations.listUserScopes.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    return c.json({ scopes: await service.listScopes(auth.workspace.id) }, 200);
  });

  app.post(operations.grantUserScope.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    const body = await readBody<GrantUserScopeRequest>(c, grantUserScopeRequestSchema);
    return c.json(await service.grantScope(auth, body), 201);
  });

  return app;
}
