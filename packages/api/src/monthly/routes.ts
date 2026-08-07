import type { RecalculateAttendanceRequest } from '@staffweave/contracts';
import {
  listAttendanceDaysQuerySchema,
  listMonthlySummariesQuerySchema,
  listPeriodSummariesQuerySchema,
  operations,
  recalculateAttendanceRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { readBody, readQuery } from '../shared/request.js';
import type { OvertimeReportService } from './overtime-report.js';
import type { PeriodService } from './period-service.js';
import type { MonthlyService } from './service.js';

export interface MonthlyRouteDependencies {
  service: MonthlyService;
  periods: PeriodService;
  overtime: OvertimeReportService;
}

export function createMonthlyRoutes(deps: MonthlyRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { service, periods } = deps;

  app.get(operations.listAttendanceDays.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; period: string }>(
      c,
      listAttendanceDaysQuerySchema,
    );
    return c.json({ days: await service.listDays(auth, query) }, 200);
  });

  app.get(operations.listMonthlySummaries.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; period: string }>(
      c,
      listMonthlySummariesQuerySchema,
    );
    return c.json({ summaries: await service.listSummaries(auth, query) }, 200);
  });

  app.get(operations.listOvertimeWarnings.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ employeeId?: string; period: string }>(
      c,
      listMonthlySummariesQuerySchema,
    );
    return c.json(await deps.overtime.listWarnings(auth, query), 200);
  });

  app.get(operations.listPeriodSummaries.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{
      employeeId: string;
      from: string;
      to: string;
      kind?: 'week' | 'settlement';
    }>(c, listPeriodSummariesQuerySchema);
    return c.json({ summaries: await periods.listSummaries(auth, query) }, 200);
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
