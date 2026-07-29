import type { CorrectAttendanceRequest, RecordAttendanceEventRequest } from '@staffweave/contracts';
import {
  correctAttendanceRequestSchema,
  operations,
  recordAttendanceEventRequestSchema,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { readBody } from '../shared/request.js';
import type { AttendanceService } from './service.js';

export interface AttendanceRouteDependencies {
  service: AttendanceService;
}

export function createAttendanceRoutes(deps: AttendanceRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(operations.recordAttendanceEvent.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<RecordAttendanceEventRequest>(
      c,
      recordAttendanceEventRequestSchema,
    );
    // 画面からの打刻はすべて web として記録する。端末や携帯からの経路は後続フェーズで追加する。
    const { result, created } = await deps.service.recordEvent(auth, body, 'web');
    return c.json(result, created ? 201 : 200);
  });

  app.post(operations.correctAttendance.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<CorrectAttendanceRequest>(c, correctAttendanceRequestSchema);
    const { result, created } = await deps.service.correct(auth, body);
    return c.json(result, created ? 201 : 200);
  });

  app.get(operations.getTodayAttendance.path, async (c) =>
    c.json(await deps.service.getToday(currentAuth(c)), 200),
  );

  app.get('/attendance/days/:businessDate', async (c) =>
    c.json(await deps.service.getDay(currentAuth(c), c.req.param('businessDate')), 200),
  );

  return app;
}
