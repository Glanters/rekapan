import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { NotFoundError } from '../errors';
import { resolveUserNames } from '../users/service';

import {
  type CellValue,
  listBanks,
  listColumns,
  type MonthlyCommitResult,
  type MonthlyPlanContext,
} from './service';

/**
 * Edit history for Monthly reports.
 *
 * Every write records only what changed, before and after, keyed by column key
 * (and bank code for the Validasi breakdown) — so the trail answers "who set
 * Deposit from 10 jt to 8 jt, and when" without anyone diffing snapshots by
 * hand. Keys rather than ids: the log must stay readable after a column is
 * renamed, and a key never changes.
 */

const ENTITY = 'MonthlyReport';

type Source = 'form' | 'import';

interface StoredDiff {
  reportDate: string;
  source: Source;
  values?: Record<string, CellValue>;
  validations?: Record<string, number | null>;
}

/** Records one report write. Skips an import row that changed nothing. */
export async function recordMonthlyWrite(
  ctx: AccessContext,
  params: {
    siteId: string;
    reportDate: string;
    result: MonthlyCommitResult;
    context: MonthlyPlanContext;
    source: Source;
  },
): Promise<void> {
  const { result, context, source } = params;
  if (source === 'import' && !result.created && isEmpty(result)) return;

  const keyById = new Map([...context.columnByKey.values()].map((c) => [c.id, c.key]));
  const codeById = new Map([...context.bankByCode.values()].map((b) => [b.id, b.code]));

  const before: StoredDiff = { reportDate: params.reportDate, source };
  const after: StoredDiff = { reportDate: params.reportDate, source };
  if (result.changes.length > 0) {
    before.values = {};
    after.values = {};
    for (const change of result.changes) {
      const key = keyById.get(change.columnId) ?? change.columnId;
      before.values[key] = change.before;
      after.values[key] = change.after;
    }
  }
  if (result.bankChanges.length > 0) {
    before.validations = {};
    after.validations = {};
    for (const change of result.bankChanges) {
      const code = codeById.get(change.bankId) ?? change.bankId;
      before.validations[code] = change.before;
      after.validations[code] = change.after;
    }
  }

  await recordAudit({
    action: result.created ? 'monthly.created' : 'monthly.updated',
    module: 'Monthly',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: params.siteId,
    entityType: ENTITY,
    entityId: result.id,
    // A new report has no "before"; storing an all-null one would read as a
    // list of cleared figures.
    before: result.created ? undefined : before,
    after,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}

function isEmpty(result: MonthlyCommitResult): boolean {
  return result.changes.length === 0 && result.bankChanges.length === 0;
}

// ============================================================================
// Reading the history back
// ============================================================================

export interface MonthlyHistoryChange {
  label: string;
  before: CellValue;
  after: CellValue;
  /** Digits to render a number with; null for non-numeric fields. */
  digits: number | null;
}

export interface MonthlyHistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted' | 'other';
  at: string;
  actor: string;
  source: Source | null;
  /**
   * Field-level changes. Null for entries written before field-level history
   * existed, which only recorded the values saved, not what they replaced.
   */
  changes: MonthlyHistoryChange[] | null;
}

/** Most recent first; bounded, since this backs a popover rather than a page. */
const HISTORY_LIMIT = 30;

export async function getMonthlyHistory(
  ctx: AccessContext,
  reportId: string,
): Promise<MonthlyHistoryEntry[]> {
  ctx.requirePermission('monthly.view');

  // Resolved through the site-scoped client: a report outside the caller's
  // sites is "not found", never a history of someone else's figures.
  const report = await scopedDb(ctx).monthlyReport.findFirst({
    where: scopedWhere(ctx, 'MonthlyReport', { id: reportId }),
    select: { id: true },
  });
  if (!report) throw new NotFoundError('Laporan tidak ditemukan.');

  const [logs, columns, banks] = await Promise.all([
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
    listColumns(),
    listBanks(),
  ]);

  const names = await resolveUserNames(logs.map((log) => log.actorId));
  const columnByKey = new Map(columns.map((c) => [c.key, c]));
  const bankByCode = new Map(banks.map((b) => [b.code, b]));

  return logs.map((log) => {
    const before = (log.before ?? null) as StoredDiff | null;
    const after = (log.after ?? null) as StoredDiff | null;
    const fieldLevel = after !== null && 'source' in after;

    let changes: MonthlyHistoryChange[] | null = null;
    if (fieldLevel) {
      changes = [];
      for (const [key, value] of Object.entries(after.values ?? {})) {
        const column = columnByKey.get(key);
        const numeric =
          column &&
          ['CURRENCY', 'DECIMAL', 'INTEGER', 'PERCENT'].includes(column.dataType);
        changes.push({
          label: column?.label ?? key,
          before: before?.values?.[key] ?? null,
          after: value,
          digits: numeric ? column.precision : null,
        });
      }
      for (const [code, value] of Object.entries(after.validations ?? {})) {
        changes.push({
          label: `Validasi ${bankByCode.get(code)?.name ?? code}`,
          before: before?.validations?.[code] ?? null,
          after: value,
          digits: 0,
        });
      }
    }

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
