import type { JsonSchema } from '@staffweave/contracts';
import { listAnomaliesQuerySchema, operations, validate } from '@staffweave/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../shared/context.js';
import { requirePermission } from '../shared/context.js';
import { invalidRequest } from '../shared/errors.js';
import type { AnomalyService } from './anomaly-service.js';
import { anomaliesToCsv } from './anomaly-service.js';
import type { AuditRepository } from './repository.js';

export interface AuditRouteDependencies {
  anomalies: AnomalyService;
  logs: AuditRepository;
}

function readQuery<T>(c: Context<AppEnv>, schema: JsonSchema): T {
  const result = validate<T>(schema, Object.fromEntries(new URL(c.req.url).searchParams));
  if (!result.valid) throw invalidRequest(result.problems);
  return result.value;
}

export function createAuditRoutes(deps: AuditRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get(operations.listAnomalies.path, async (c) => {
    const auth = requirePermission(c, 'employee.read');
    const query = readQuery<{
      from: string;
      to: string;
      employeeId?: string;
      format?: 'json' | 'csv';
    }>(c, listAnomaliesQuerySchema);

    const anomalies = await deps.anomalies.list(auth, query);

    if (query.format === 'csv') {
      return c.body(anomaliesToCsv(anomalies), 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="anomalies-${query.from}-${query.to}.csv"`,
      });
    }

    return c.json({ anomalies }, 200);
  });

  // 監査記録は従業員に紐づかない操作も含み、要約に氏名がそのまま入る。
  // 閲覧範囲で機械的に絞れないため、ワークスペース管理者だけが読めるようにする。
  app.get(operations.listAuditLogs.path, async (c) => {
    const auth = requirePermission(c, 'audit.read');
    return c.json({ logs: await deps.logs.listRecent(auth.workspace.id, 200) }, 200);
  });

  return app;
}
