import type { CreateApiKeyRequest } from '@staffweave/contracts';
import {
  createApiKeyRequestSchema,
  exportAttendanceQuerySchema,
  exportPayrollQuerySchema,
  honoPath,
  operations,
} from '@staffweave/contracts';
import type { ApiScope, EmployeeVisibility } from '@staffweave/domain';
import { parseCsv } from '@staffweave/domain';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { OrganizationService } from '../organization/service.js';
import type { AppEnv } from '../shared/context.js';
import { currentAuth, requirePermission } from '../shared/context.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { invalidRequest, notFound } from '../shared/errors.js';
import { pathParam, readBody, readQuery } from '../shared/request.js';
import type { ExportService } from './export-service.js';
import type { IntegrationService } from './service.js';

export interface IntegrationRouteDependencies {
  integration: IntegrationService;
  exports: ExportService;
  organization: OrganizationService;
  visibility: EmployeeVisibilityGuard;
}

/**
 * 外部連携の経路。
 *
 * 読み取りの出力はセッションでも API キーでも使えるようにする。
 * API キーで来た場合は、キーに与えられたスコープで判断する。
 */
export function createIntegrationRoutes(deps: IntegrationRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * 出力の対象を決める。
   *
   * API キーはワークスペース単位のスコープであり、組織単位の制限は持たない。
   * セッションでは、その利用者が画面で見られる範囲と同じ範囲を出力する。
   * 出力だけ広い範囲を返すと、画面で隠した相手が CSV から読めてしまう。
   */
  function resolveExportTarget(
    c: Context<AppEnv>,
    scope: ApiScope,
  ): { workspaceId: string; visibility: EmployeeVisibility } {
    const apiKey = c.get('apiKey');
    if (apiKey) {
      if (!apiKey.scopes.includes(scope)) {
        throw invalidRequest([
          { field: 'scope', message: `この API キーには ${scope} が与えられていません` },
        ]);
      }
      return { workspaceId: apiKey.workspaceId, visibility: { kind: 'workspace' } };
    }
    const auth = requirePermission(c, 'employee.read');
    return { workspaceId: auth.workspace.id, visibility: deps.visibility.of(auth) };
  }

  app.get(honoPath(operations.exportAttendanceCsv), async (c) => {
    const target = resolveExportTarget(c, 'attendance:read');
    const query = readQuery<{ from: string; to: string }>(c, exportAttendanceQuerySchema);
    const csv = await deps.exports.attendanceCsv(target.workspaceId, target.visibility, query);
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="attendance.csv"',
    });
  });

  app.get(honoPath(operations.exportPayrollCsv), async (c) => {
    const target = resolveExportTarget(c, 'payroll:read');
    const query = readQuery<{ period: string }>(c, exportPayrollQuerySchema);
    const csv = await deps.exports.payrollCsv(target.workspaceId, target.visibility, query);
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="payroll.csv"',
    });
  });

  app.post(honoPath(operations.importEmployeesCsv), async (c) => {
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
    // 契約で検証してから先へ渡す。経路ごとに書き分けると、書いた経路だけが契約どおりになる。
    const body = await readBody<CreateApiKeyRequest>(c, createApiKeyRequestSchema);
    return c.json(await deps.integration.createApiKey(auth, body), 201);
  });

  app.post(honoPath(operations.revokeApiKey), async (c) => {
    const auth = requirePermission(c, 'user.manage');
    return c.json(
      await deps.integration.revokeApiKey(auth.workspace.id, pathParam(c, 'apiKeyId')),
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

  app.get(operations.listAbandonedDeliveries.path, async (c) => {
    const auth = requirePermission(c, 'user.manage');
    return c.json(
      { deliveries: await deps.integration.listAbandonedDeliveries(auth.workspace.id) },
      200,
    );
  });

  app.post(honoPath(operations.requeueAbandonedDelivery), async (c) => {
    const auth = requirePermission(c, 'user.manage');
    const requeued = await deps.integration.requeueAbandonedDelivery(
      auth.workspace.id,
      pathParam(c, 'outboxId'),
    );
    if (!requeued) throw notFound('諦めた通知');
    return c.body(null, 204);
  });

  app.get(honoPath(operations.listWebhookDeliveries), async (c) => {
    const auth = currentAuth(c);
    requirePermission(c, 'user.manage');
    return c.json({ deliveries: await deps.integration.listDeliveries(auth.workspace.id) }, 200);
  });

  return app;
}
