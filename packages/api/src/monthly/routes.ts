import type { RecalculateAttendanceRequest } from '@staffweave/contracts';
import {
  listMonthlySummariesQuerySchema,
  operations,
  recalculateAttendanceRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { readBody, readQuery } from '../shared/request.js';
import type { MonthlyService } from './service.js';

export interface MonthlyRouteDependencies {
  service: MonthlyService;
}

export function createMonthlyRoutes(deps: MonthlyRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service } = deps;

  app.get(operations.listMonthlySummaries.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; period: string }>(
      c,
      listMonthlySummariesQuerySchema,
    );
    return c.json({ summaries: await service.listSummaries(auth, query) }, 200);
  });

  app.get(operations.listClosingReadiness.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; period: string }>(
      c,
      listMonthlySummariesQuerySchema,
    );
    return c.json({ readiness: await service.listReadiness(auth, query) }, 200);
  });

  app.post(operations.recalculateAttendance.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<RecalculateAttendanceRequest>(
      c,
      recalculateAttendanceRequestSchema,
    );
    return c.json(await service.recalculate(auth, body), 200);
  });

  return app;
}
