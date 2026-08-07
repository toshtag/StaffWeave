import type { MarkNotificationsReadRequest } from '@staffweave/contracts';
import {
  listNotificationsQuerySchema,
  markNotificationsReadRequestSchema,
  operations,
} from '@staffweave/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { currentAuth } from '../shared/context.js';
import { readBody, readQuery } from '../shared/request.js';
import type { NotificationService } from './service.js';

export interface NotificationRouteDependencies {
  service: NotificationService;
}

export function createNotificationRoutes(deps: NotificationRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get(operations.listNotifications.path, async (c) => {
    const auth = currentAuth(c);
    const query = readQuery<{ unreadOnly?: 'true' | 'false' }>(c, listNotificationsQuerySchema);
    return c.json(await deps.service.list(auth, { unreadOnly: query.unreadOnly === 'true' }), 200);
  });

  app.post(operations.markNotificationsRead.path, async (c) => {
    const auth = currentAuth(c);
    const body = await readBody<MarkNotificationsReadRequest>(
      c,
      markNotificationsReadRequestSchema,
    );
    return c.json(await deps.service.markRead(auth, body.ids), 200);
  });

  return app;
}
