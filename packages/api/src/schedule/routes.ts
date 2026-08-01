import type {
  AssignWorkCycleRequest,
  CreateLeaveTypeRequest,
  CreateWorkCycleRequest,
  CreateWorkPatternRequest,
  EndWorkCycleAssignmentRequest,
  GenerateWorkSchedulesRequest,
  UpsertWorkScheduleRequest,
} from '@staffweave/contracts';
import {
  assignWorkCycleRequestSchema,
  createLeaveTypeRequestSchema,
  createWorkCycleRequestSchema,
  createWorkPatternRequestSchema,
  endWorkCycleAssignmentRequestSchema,
  generateWorkSchedulesRequestSchema,
  honoPath,
  listWorkSchedulesQuerySchema,
  operations,
  upsertWorkScheduleRequestSchema,
  validate,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { invalidRequest } from '../shared/errors.js';
import { pathParam, readBody } from '../shared/request.js';
import type { ScheduleService } from './service.js';

export interface ScheduleRouteDependencies {
  service: ScheduleService;
}

export function createScheduleRoutes(deps: ScheduleRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

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
    const query = validate<{ employeeId: string; from: string; to: string }>(
      listWorkSchedulesQuerySchema,
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!query.valid) throw invalidRequest(query.problems);
    return c.json({ workSchedules: await service.listWorkSchedules(auth, query.value) }, 200);
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
    const employeeId = new URL(c.req.url).searchParams.get('employeeId');
    if (employeeId === null) {
      throw invalidRequest([{ field: 'employeeId', message: '従業員を指定してください' }]);
    }
    return c.json({ assignments: await service.listAssignments(auth, employeeId) }, 200);
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
