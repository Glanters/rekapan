import { auditModules, listAuditLogs } from '@/server/audit/service';
import { paginated } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/** Parses an ISO date from the query string, ignoring anything unparseable. */
function parseDate(value: string | null, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(
    endOfDay && value.length === 10 ? `${value}T23:59:59.999` : value,
  );
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * GET /api/admin/audit
 *
 * One page of the audit trail. There is deliberately no POST, PATCH, or DELETE
 * on this resource: the trail is append-only, written solely by `recordAudit`,
 * and an endpoint that let an administrator rewrite it would defeat the point
 * of keeping it.
 *
 * Bounds are applied in the service rather than here, so a hand-crafted
 * `perPage=100000` is clamped rather than honoured.
 */
export const GET = route({
  permission: 'audit.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const { entries, total, page, perPage } = await listAuditLogs(access, {
      module: params.get('module') ?? undefined,
      action: params.get('action')?.trim() || undefined,
      actorEmail: params.get('actorEmail')?.trim() || undefined,
      from: parseDate(params.get('from'), false),
      to: parseDate(params.get('to'), true),
      page: parseInteger(params.get('page')),
      perPage: parseInteger(params.get('perPage')),
    });

    return paginated(
      entries,
      { page, perPage, total },
      { meta: { modules: auditModules() } },
    );
  },
});
