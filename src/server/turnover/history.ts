import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { NotFoundError } from '../errors';
import type { MonthlyHistoryEntry } from '../monthly/history';
import { resolveUserNames } from '../users/service';

import {
  listGames,
  type TurnoverCommitResult,
  type TurnoverPlanContext,
} from './service';

/**
 * Edit history for Turnover reports — the same shape as Monthly's, so one
 * table component renders both. Amounts are keyed by game code, which never
 * changes, so the log stays readable after a game is renamed.
 */

const ENTITY = 'TurnoverReport';

type Source = 'form' | 'import';

interface StoredDiff {
  reportDate: string;
  source: Source;
  values?: Record<string, number | null>;
}

export async function recordTurnoverWrite(
  ctx: AccessContext,
  params: {
    siteId: string;
    reportDate: string;
    result: TurnoverCommitResult;
    context: TurnoverPlanContext;
    source: Source;
  },
): Promise<void> {
  const { result, context, source } = params;
  if (source === 'import' && !result.created && result.changes.length === 0) return;

  const codeById = new Map([...context.gameByCode.values()].map((g) => [g.id, g.code]));
  const before: StoredDiff = { reportDate: params.reportDate, source };
  const after: StoredDiff = { reportDate: params.reportDate, source };
  if (result.changes.length > 0) {
    before.values = {};
    after.values = {};
    for (const change of result.changes) {
      const code = codeById.get(change.gameId) ?? change.gameId;
      before.values[code] = change.before;
      after.values[code] = change.after;
    }
  }

  await recordAudit({
    action: result.created ? 'turnover.created' : 'turnover.updated',
    module: 'Turnover',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: params.siteId,
    entityType: ENTITY,
    entityId: result.id,
    before: result.created ? undefined : before,
    after,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}

const HISTORY_LIMIT = 30;

export async function getTurnoverHistory(
  ctx: AccessContext,
  reportId: string,
): Promise<MonthlyHistoryEntry[]> {
  ctx.requirePermission('turnover.view');

  // Site-scoped lookup: another site's report reads as not found.
  const report = await scopedDb(ctx).turnoverReport.findFirst({
    where: scopedWhere(ctx, 'TurnoverReport', { id: reportId }),
    select: { id: true },
  });
  if (!report) throw new NotFoundError('Laporan tidak ditemukan.');

  const [logs, games] = await Promise.all([
    unsafeDb.auditLog.findMany({
      where: { entityType: ENTITY, entityId: report.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actorId: true,
        actorEmail: true,
        before: true,
        after: true,
      },
    }),
    listGames(),
  ]);

  const names = await resolveUserNames(logs.map((log) => log.actorId));
  const gameByCode = new Map(games.map((g) => [g.code, g]));

  return logs.map((log) => {
    const before = (log.before ?? null) as StoredDiff | null;
    const after = (log.after ?? null) as StoredDiff | null;
    const fieldLevel = after !== null && 'source' in after;

    const changes = fieldLevel
      ? Object.entries(after.values ?? {}).map(([code, value]) => ({
          label: gameByCode.get(code)?.name ?? code,
          before: before?.values?.[code] ?? null,
          after: value,
          digits: 2,
        }))
      : null;

    const action = log.action.endsWith('.created')
      ? 'created'
      : log.action.endsWith('.updated')
        ? 'updated'
        : log.action.endsWith('.deleted')
          ? 'deleted'
          : 'other';

    return {
      id: log.id,
      action,
      at: log.createdAt.toISOString(),
      actor:
        (log.actorId ? names.get(log.actorId) : undefined) ??
        log.actorEmail ??
        'Sistem',
      source: fieldLevel ? after.source : null,
      changes,
    };
  });
}
