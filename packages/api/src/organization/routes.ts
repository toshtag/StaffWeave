import type {
  CreateDepartmentRequest,
  CreateEmployeeRequest,
  CreateOrganizationRequest,
  CreateSiteRequest,
} from '@staffweave/contracts';
import {
  createDepartmentRequestSchema,
  createEmployeeRequestSchema,
  createOrganizationRequestSchema,
  createSiteRequestSchema,
  operations,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { readBody } from '../shared/request.js';
import type { OrganizationService } from './service.js';

export interface OrganizationRouteDependencies {
  service: OrganizationService;
}

export function createOrganizationRoutes(deps: OrganizationRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listOrganizations.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ organizations: await service.listOrganizations(auth.workspace.id) }, 200);
  });

  app.post(operations.createOrganization.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateOrganizationRequest>(c, createOrganizationRequestSchema);
    return c.json(await service.createOrganization(auth.workspace.id, body), 201);
  });

  app.get(operations.listSites.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ sites: await service.listSites(auth.workspace.id) }, 200);
  });

  app.post(operations.createSite.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateSiteRequest>(c, createSiteRequestSchema);
    return c.json(await service.createSite(auth.workspace.id, body), 201);
  });

  app.get(operations.listDepartments.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ departments: await service.listDepartments(auth.workspace.id) }, 200);
  });

  app.post(operations.createDepartment.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateDepartmentRequest>(c, createDepartmentRequestSchema);
    return c.json(await service.createDepartment(auth.workspace.id, body), 201);
  });

  app.get(operations.listEmployees.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    return c.json({ employees: await service.listEmployees(auth.workspace.id) }, 200);
  });

  app.post(operations.createEmployee.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<CreateEmployeeRequest>(c, createEmployeeRequestSchema);
    return c.json(await service.createEmployee(auth.workspace.id, body), 201);
  });

  return app;
}
