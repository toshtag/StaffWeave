import type { Database } from '@staffweave/db';
import { Hono } from 'hono';
import { createSystemRoutes } from './routes/system.js';

export interface AppDependencies {
  db: Database;
  now?: () => Date;
}

export function createApp(deps: AppDependencies): Hono {
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.route('/api', createSystemRoutes({ db: deps.db, now }));

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: '該当する API がありません' } }, 404),
  );

  app.onError((error, c) => {
    console.error(error);
    return c.json(
      { error: { code: 'internal_error', message: 'サーバー内部でエラーが発生しました' } },
      500,
    );
  });

  return app;
}
