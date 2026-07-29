import { operations } from '@staffweave/contracts';
import type { ApiScope } from '@staffweave/domain';
import { parseCsv } from '@staffweave/domain';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { OrganizationService } from '../organization/service.js';
import type { AppEnv } from '../shared/context.js';
import { currentAuth, requirePermission } from '../shared/context.js';
import { invalidRequest } from '../shared/errors.js';
import type { ExportService } from './export-service.js';
import type { IntegrationService } from './service.js';

export interface IntegrationRouteDependencies {
  integration: IntegrationService;
  exports: ExportService;
  organization: OrganizationService;
}

/**
 * 外部連携の経路。
 *
 * 読み取りの出力はセッションでも API キーでも使えるようにする。
 * API キーで来た場合は、キーに与えられたスコープで判断する。
 */
export function createIntegrationRoutes(deps: IntegrationRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  function resolveWorkspace(c: Context<AppEnv>, scope: ApiScope): string {
    const apiKey = c.get('apiKey');
    if (apiKey) {
      if (!apiKey.scopes.includes(scope)) {
        throw invalidRequest([
          { field: 'scope', message: `この API キーには ${scope} が与えられていません` },
        ]);
      }
      return apiKey.workspaceId;
    }
    return requirePermission(c, 'employee.read').workspace.id;
  }

  app.get('/exports/attendance.csv', async (c) => {
    const url = new URL(c.req.url);
    const workspaceId = resolveWorkspace(c, 'attendance:read');
    const csv = await deps.exports.attendanceCsv(workspaceId, {
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
    });
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="attendance.csv"',
    });
  });

  app.get('/exports/payroll.csv', async (c) => {
    const url = new URL(c.req.url);
    const workspaceId = resolveWorkspace(c, 'payroll:read');
    const csv = await deps.exports.payrollCsv(workspaceId, {
      period: url.searchParams.get('period') ?? '',
    });
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="payroll.csv"',
    });
  });

  app.post('/imports/employees', async (c) => {
    const auth = requirePermission(c, 'employee.manage');
    const text = await c.req.text();
    const parsed = parseCsv(text);

    const required = ['organization_code', 'employee_number', 'display_name'];
    const missing = required.filter((column) => !parsed.header.includes(column));
    if (missing.length > 0) {
      throw invalidRequest([
        { field: 'header', message: `見出しに ${missing.join(', ')} が必要です` },
      ]);
    }

    const organizations = await deps.organization.listOrganizations(auth.workspace.id);
    const byCode = new Map(
      organizations.map((organization) => [organization.code, organization.id]),
    );

    let created = 0;
    const problems = parsed.problems.map((problem) => ({
      line: problem.line,
      message: problem.message,
    }));

    for (const [index, row] of parsed.rows.entries()) {
      const organizationId = byCode.get((row.organization_code ?? '').toUpperCase());
      if (organizationId === undefined) {
        problems.push({
          line: index + 2,
          message: `組織コード ${row.organization_code ?? ''} が見つかりません`,
        });
        continue;
      }

      try {
        await deps.organization.createEmployee(auth.workspace.id, {
          organizationId,
          employeeNumber: row.employee_number ?? '',
          displayName: row.display_name ?? '',
          ...(row.hired_on ? { hiredOn: row.hired_on } : {}),
        });
        created += 1;
      } catch (error) {
        problems.push({
          line: index + 2,
          message: error instanceof Error ? error.message : '登録できませんでした',
        });
      }
    }

    return c.json({ created, problems }, 200);
  });

  app.get(operations.listApiKeys.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    return c.json({ apiKeys: await deps.integration.listApiKeys(auth.workspace.id) }, 200);
  });

  app.post(operations.createApiKey.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    const body = (await c.req.json()) as { name?: string; scopes?: string[] };
    if (typeof body.name !== 'string' || !Array.isArray(body.scopes)) {
      throw invalidRequest([{ field: 'name', message: '名前とスコープを指定してください' }]);
    }
    const result = await deps.integration.createApiKey(auth, {
      name: body.name,
      scopes: body.scopes,
    });
    return c.json(result, 201);
  });

  app.post('/api-keys/:apiKeyId/revoke', async (c) => {
    const auth = requirePermission(c, 'user.manage');
    return c.json(
      await deps.integration.revokeApiKey(auth.workspace.id, c.req.param('apiKeyId')),
      200,
    );
  });

  app.get(operations.listWebhookEndpoints.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    return c.json({ endpoints: await deps.integration.listEndpoints(auth.workspace.id) }, 200);
  });

  app.post(operations.createWebhookEndpoint.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    const body = (await c.req.json()) as { name?: string; url?: string; eventTypes?: string[] };
    if (
      typeof body.name !== 'string' ||
      typeof body.url !== 'string' ||
      !Array.isArray(body.eventTypes)
    ) {
      throw invalidRequest([
        { field: 'url', message: '名前・URL・出来事の種別を指定してください' },
      ]);
    }
    const result = await deps.integration.createEndpoint(auth.workspace.id, {
      name: body.name,
      url: body.url,
      eventTypes: body.eventTypes,
    });
    return c.json(result, 201);
  });

  app.get('/webhook-deliveries', async (c) => {
    const auth = currentAuth(c);
    requirePermission(c, 'user.manage');
    return c.json({ deliveries: await deps.integration.listDeliveries(auth.workspace.id) }, 200);
  });

  return app;
}
