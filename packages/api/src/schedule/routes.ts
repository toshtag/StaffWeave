import type {
  AssignWorkCycleRequest,
  CreateCalculationRuleVersionRequest,
  CreateLaborSystemAssignmentRequest,
  CreateLeaveTypeRequest,
  CreateWorkCategoryRequest,
  CreateWorkCycleRequest,
  CreateWorkPatternRequest,
  EndLaborSystemAssignmentRequest,
  EndWorkCycleAssignmentRequest,
  GenerateWorkSchedulesRequest,
  UpsertWorkScheduleRequest,
} from '@staffweave/contracts';
import {
  assignWorkCycleRequestSchema,
  createCalculationRuleVersionRequestSchema,
  createLaborSystemAssignmentRequestSchema,
  createLeaveTypeRequestSchema,
  createWorkCategoryRequestSchema,
  createWorkCycleRequestSchema,
  createWorkPatternRequestSchema,
  endLaborSystemAssignmentRequestSchema,
  endWorkCycleAssignmentRequestSchema,
  generateWorkSchedulesRequestSchema,
  honoPath,
  listEmployeeWorkCyclesQuerySchema,
  listWorkSchedulesQuerySchema,
  operations,
  upsertWorkScheduleRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { ScheduleService } from './service.js';

export interface ScheduleRouteDependencies {
  service: ScheduleService;
}

export function createScheduleRoutes(deps: ScheduleRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listWorkCategories.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ workCategories: await service.listWorkCategories(auth.workspace.id) }, 200);
  });

  app.post(operations.createWorkCategory.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateWorkCategoryRequest>(c, createWorkCategoryRequestSchema);
    return c.json(await service.createWorkCategory(auth.workspace.id, body), 201);
  });

  app.get(operations.listCalculationRuleVersions.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json(
      { calculationRuleVersions: await service.listCalculationRuleVersions(auth.workspace.id) },
      200,
    );
  });

  app.post(operations.createCalculationRuleVersion.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateCalculationRuleVersionRequest>(
      c,
      createCalculationRuleVersionRequestSchema,
    );
    return c.json(await service.createCalculationRuleVersion(auth.workspace.id, body), 201);
  });

  app.get(operations.listLaborSystemAssignments.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    const query = readQuery<{ employeeId: string }>(c, listEmployeeWorkCyclesQuerySchema);
    return c.json(
      { laborSystemAssignments: await service.listLaborSystemAssignments(auth, query.employeeId) },
      200,
    );
  });

  app.post(operations.assignLaborSystem.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<CreateLaborSystemAssignmentRequest>(
      c,
      createLaborSystemAssignmentRequestSchema,
    );
    return c.json(await service.assignLaborSystem(auth, body), 201);
  });

  app.post(honoPath(operations.endLaborSystemAssignment), async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<EndLaborSystemAssignmentRequest>(
      c,
      endLaborSystemAssignmentRequestSchema,
    );
    return c.json(
      await service.endLaborSystemAssignment(
        auth,
        pathParam(c, 'laborSystemAssignmentId'),
        body.effectiveTo,
      ),
      200,
    );
  });

  app.get(operations.listWorkPatterns.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ workPatterns: await service.listWorkPatterns(auth.workspace.id) }, 200);
  });

  app.post(operations.createWorkPattern.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateWorkPatternRequest>(c, createWorkPatternRequestSchema);
    return c.json(await service.createWorkPattern(auth.workspace.id, body), 201);
  });

  app.get(operations.listWorkSchedules.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    const query = readQuery<{ employeeId: string; from: string; to: string }>(
      c,
      listWorkSchedulesQuerySchema,
    );
    return c.json({ workSchedules: await service.listWorkSchedules(auth, query) }, 200);
  });

  app.put(operations.upsertWorkSchedule.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<UpsertWorkScheduleRequest>(c, upsertWorkScheduleRequestSchema);
    return c.json(await service.upsertWorkSchedule(auth, body), 200);
  });

  app.get(operations.listLeaveTypes.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ leaveTypes: await service.listLeaveTypes(auth.workspace.id) }, 200);
  });

  app.post(operations.createLeaveType.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateLeaveTypeRequest>(c, createLeaveTypeRequestSchema);
    return c.json(await service.createLeaveType(auth.workspace.id, body), 201);
  });

  app.get(operations.listWorkCycles.path, async (c) => {
    const auth = requirePermission(c, 'organization.read');
    return c.json({ workCycles: await service.listWorkCycles(auth.workspace.id) }, 200);
  });

  app.post(operations.createWorkCycle.path, async (c) => {
    const auth = requirePermission(c, 'organization.manage');
    const body = await readBody<CreateWorkCycleRequest>(c, createWorkCycleRequestSchema);
    return c.json(await service.createWorkCycle(auth.workspace.id, body), 201);
  });

  app.get(operations.listEmployeeWorkCycles.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    const query = readQuery<{ employeeId: string }>(c, listEmployeeWorkCyclesQuerySchema);
    return c.json({ assignments: await service.listAssignments(auth, query.employeeId) }, 200);
  });

  app.post(operations.assignWorkCycle.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<AssignWorkCycleRequest>(c, assignWorkCycleRequestSchema);
    return c.json(await service.assignWorkCycle(auth.workspace.id, body), 201);
  });

  app.post(honoPath(operations.endWorkCycleAssignment), async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<EndWorkCycleAssignmentRequest>(
      c,
      endWorkCycleAssignmentRequestSchema,
    );
    return c.json(
      await service.endWorkCycleAssignment(
        auth.workspace.id,
        pathParam(c, 'employeeWorkCycleId'),
        body,
      ),
      200,
    );
  });

  app.post(operations.generateWorkSchedules.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<GenerateWorkSchedulesRequest>(
      c,
      generateWorkSchedulesRequestSchema,
    );
    return c.json(await service.generateWorkSchedules(auth, body), 200);
  });

  return app;
}
