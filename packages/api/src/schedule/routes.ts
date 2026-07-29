import type { CreateWorkPatternRequest, UpsertWorkScheduleRequest } from '@staffweave/contracts';
import {
  createWorkPatternRequestSchema,
  listWorkSchedulesQuerySchema,
  operations,
  upsertWorkScheduleRequestSchema,
  validate,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { invalidRequest } from '../shared/errors.js';
import { readBody } from '../shared/request.js';
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
    return c.json(
      { workSchedules: await service.listWorkSchedules(auth.workspace.id, query.value) },
      200,
    );
  });

  app.put(operations.upsertWorkSchedule.path, async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const body = await readBody<UpsertWorkScheduleRequest>(c, upsertWorkScheduleRequestSchema);
    return c.json(await service.upsertWorkSchedule(auth, body), 200);
  });

  return app;
}
