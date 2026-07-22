import type { Prisma } from '@/generated/prisma/client';
import type { ReportStatus } from '@/generated/prisma/enums';

import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { resolveUserNames } from '../users/service';

/**
 * Turnover reporting.
 *
 * Structurally the same EAV pivot as Monthly, with one simplification: a
 * Turnover cell is always a single amount, so there is no per-column data type
 * to route values through. Games are the columns — adding a row to
 * `turnover_games` adds a column here with no code change and no migration.
 */

export interface TurnoverGameDto {
  id: string;
  code: string;
  name: string;
  category: string | null;
  position: number;
}

export interface TurnoverRowDto {
  id: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  reportDate: string;
  status: ReportStatus;
  /** Keyed by game code. */
  values: Record<string, number | null>;
  /** Sum across every game for this day — the figure operators actually read. */
  rowTotal: number;
  /** ISO 8601 with time. Surfaced for the row's info popover. */
  createdAt: string;
  updatedAt: string;
  /** Display name of who created / last edited the report; null if unknown. */
  createdBy: string | null;
  updatedBy: string | null;
}

export interface TurnoverListResult {
  games: TurnoverGameDto[];
  rows: TurnoverRowDto[];
  totals: Record<string, number>;
  grandTotal: number;
  pagination: { page: number; perPage: number; total: number };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"${value}" is not a valid date.`);
  }
  return parsed;
}

export async function listGames(): Promise<TurnoverGameDto[]> {
  return unsafeDb.turnoverGame.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, category: true, position: true },
  });
}

export interface ListTurnoverParams {
  siteIds?: readonly string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}

/**
 * The filter behind both the table and the export, shared so the two cannot
 * drift apart and hand the operator a file that disagrees with the screen.
 */
function buildTurnoverWhere(
  ctx: AccessContext,
  params: ListTurnoverParams,
): Record<string, unknown> {
  const siteIds = ctx.narrowSiteFilter(params.siteIds);

  return scopedWhere(ctx, 'TurnoverReport', {
    deletedAt: null,
    ...(siteIds ? { siteId: { in: [...siteIds] } } : {}),
    ...(params.from || params.to
      ? {
          reportDate: {
            ...(params.from ? { gte: fromIsoDate(params.from) } : {}),
            ...(params.to ? { lte: fromIsoDate(params.to) } : {}),
          },
        }
      : {}),
  });
}

const REPORT_SELECT = {
  id: true,
  siteId: true,
  reportDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  site: { select: { code: true, name: true } },
  values: { select: { gameId: true, amount: true } },
} as const;

/**
 * `amount` is `unknown` because Postgres `Decimal` has no native JavaScript
 * counterpart — naming the driver's representation here would tie this module
 * to it.
 */
interface TurnoverReportRecord {
  id: string;
  siteId: string;
  reportDate: Date;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
  site: { code: string; name: string };
  values: readonly { gameId: string; amount: unknown }[];
}

/**
 * Turns one report's EAV rows into the flat record the table renders.
 *
 * @param totals Optional accumulator, passed by the list endpoint for its
 *   footer and omitted by the export, which has no page to total over.
 */
function pivotTurnoverReport(
  report: TurnoverReportRecord,
  gameById: ReadonlyMap<string, TurnoverGameDto>,
  nameById: ReadonlyMap<string, string>,
  totals?: Record<string, number>,
): TurnoverRowDto {
  const values: Record<string, number | null> = {};
  let rowTotal = 0;

  for (const value of report.values) {
    const game = gameById.get(value.gameId);
    // A value whose game was deactivated is skipped: the table has no column
    // to put it under, and silently folding it into the total would make the
    // footer disagree with the visible cells.
    if (!game) continue;

    const amount = Number(value.amount);
    values[game.code] = amount;
    rowTotal += amount;
    if (totals) totals[game.code] = (totals[game.code] ?? 0) + amount;
  }

  return {
    id: report.id,
    siteId: report.siteId,
    siteCode: report.site.code,
    siteName: report.site.name,
    reportDate: toIsoDate(report.reportDate),
    status: report.status,
    values,
    rowTotal,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    createdBy: report.createdById ? (nameById.get(report.createdById) ?? null) : null,
    updatedBy: report.updatedById ? (nameById.get(report.updatedById) ?? null) : null,
  };
}

export async function listTurnover(
  ctx: AccessContext,
  params: ListTurnoverParams = {},
): Promise<TurnoverListResult> {
  ctx.requirePermission('turnover.view');

  const page = Math.max(1, params.page ?? 1);
  // Clamped: this value reaches the database, so an arbitrary query-string
  // number would be a trivial way to request an unbounded scan.
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));

  const where = buildTurnoverWhere(ctx, params);
  const db = scopedDb(ctx);

  const [games, total, reports] = await Promise.all([
    listGames(),
    db.turnoverReport.count({ where }),
    db.turnoverReport.findMany({
      where,
      // Ascending, matching Monthly and the Excel export: a daily ledger reads
      // downwards, with the newest day last.
      orderBy: [{ reportDate: 'asc' }, { siteId: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: REPORT_SELECT,
    }),
  ]);

  const gameById = new Map(games.map((game) => [game.id, game]));
  const nameById = await resolveUserNames(
    reports.flatMap((report) => [report.createdById, report.updatedById]),
  );
  const totals: Record<string, number> = {};
  let grandTotal = 0;

  const rows = reports.map((report) => {
    const row = pivotTurnoverReport(report, gameById, nameById, totals);
    grandTotal += row.rowTotal;
    return row;
  });

  return { games, rows, totals, grandTotal, pagination: { page, perPage, total } };
}

/** Rows matching an export's filters, before any of them are fetched. */
export async function countTurnover(
  ctx: AccessContext,
  params: ListTurnoverParams = {},
): Promise<number> {
  return scopedDb(ctx).turnoverReport.count({ where: buildTurnoverWhere(ctx, params) });
}

/**
 * Yields pivoted rows in batches, oldest first.
 *
 * Offset paging is safe because `(siteId, reportDate)` is unique, which makes
 * the ordering total — no row can shift between batches and be emitted twice or
 * skipped.
 */
export async function* streamTurnoverRows(
  ctx: AccessContext,
  params: ListTurnoverParams = {},
  batchSize = 500,
): AsyncGenerator<TurnoverRowDto[]> {
  const where = buildTurnoverWhere(ctx, params);
  const games = await listGames();
  const gameById = new Map(games.map((game) => [game.id, game]));
  // The export does not surface author names, so it skips the per-batch user
  // lookup and leaves createdBy/updatedBy null.
  const noNames: ReadonlyMap<string, string> = new Map();
  const db = scopedDb(ctx);

  for (let skip = 0; ; skip += batchSize) {
    const reports = await db.turnoverReport.findMany({
      where,
      orderBy: [{ reportDate: 'asc' }, { siteId: 'asc' }],
      skip,
      take: batchSize,
      select: REPORT_SELECT,
    });

    if (reports.length === 0) return;
    yield reports.map((report) => pivotTurnoverReport(report, gameById, noNames));
    if (reports.length < batchSize) return;
  }
}

export interface UpsertTurnoverInput {
  siteId: string;
  reportDate: string;
  /** Keyed by game code; omitted games are left untouched. */
  values: Record<string, number | null>;
}

/** One report's writes, fully validated and ready to execute. */
export interface TurnoverWritePlan {
  siteId: string;
  reportDate: Date;
  values: readonly { gameId: string; amount: number }[];
  /** The report to update, or null to create one. */
  existingId: string | null;
}

/**
 * Reference data a plan is checked against, loaded once per batch rather than
 * per row so a bulk import does not issue a lookup for every line of the file.
 */
export interface TurnoverPlanContext {
  gameByCode: ReadonlyMap<string, TurnoverGameDto>;
  /** `siteId|YYYY-MM-DD` → the report already stored for that day. */
  existingByKey: ReadonlyMap<string, { id: string; status: ReportStatus }>;
}

export interface TurnoverTarget {
  siteId: string;
  /** ISO `YYYY-MM-DD`. */
  reportDate: string;
}

function planKey(siteId: string, isoDate: string): string {
  return `${siteId}|${isoDate}`;
}

/**
 * Loads the games and the already-stored reports a batch of upserts will touch.
 *
 * The lookup runs through the site-scoped client, so a report belonging to a
 * site the caller cannot reach is absent from the map rather than exposed.
 */
export async function loadTurnoverPlanContext(
  ctx: AccessContext,
  targets: readonly TurnoverTarget[],
): Promise<TurnoverPlanContext> {
  const games = await listGames();
  const gameByCode = new Map(games.map((game) => [game.code, game]));
  const existingByKey = new Map<string, { id: string; status: ReportStatus }>();

  if (targets.length === 0) return { gameByCode, existingByKey };

  const siteIds = [...new Set(targets.map((target) => target.siteId))];
  const dates = [...new Set(targets.map((target) => target.reportDate))].map(
    fromIsoDate,
  );

  // The cross product of distinct sites and dates, rather than one OR branch
  // per target: a branch-per-row filter grows the query with the size of the
  // upload, and surplus matches are discarded by the keyed lookup anyway.
  const existing = await scopedDb(ctx).turnoverReport.findMany({
    where: scopedWhere(ctx, 'TurnoverReport', {
      siteId: { in: siteIds },
      reportDate: { in: dates },
    }),
    select: { id: true, siteId: true, reportDate: true, status: true },
  });

  for (const report of existing) {
    existingByKey.set(planKey(report.siteId, toIsoDate(report.reportDate)), {
      id: report.id,
      status: report.status,
    });
  }

  return { gameByCode, existingByKey };
}

/**
 * Validates one upsert without touching the database, so a preview can reach
 * the same verdicts the commit would without persisting anything.
 *
 * @throws {SiteAccessDeniedError} The target site is outside the caller's reach.
 * @throws {ValidationError} Unknown game, unparseable date, or a non-numeric amount.
 * @throws {ConflictError} The target report is locked.
 */
export function planTurnoverUpsert(
  ctx: AccessContext,
  input: UpsertTurnoverInput,
  context: TurnoverPlanContext,
): TurnoverWritePlan {
  ctx.requireSite(input.siteId);

  const reportDate = fromIsoDate(input.reportDate);

  const unknown = Object.keys(input.values).filter(
    (code) => !context.gameByCode.has(code),
  );
  if (unknown.length > 0) {
    throw new ValidationError('The submitted data refers to unknown games.', {
      unknownGames: unknown,
    });
  }

  const existing = context.existingByKey.get(planKey(input.siteId, input.reportDate));
  if (existing?.status === 'LOCKED') {
    throw new ConflictError(
      'That report is locked and can no longer be edited. Ask a manager to unlock it first.',
    );
  }

  const values = Object.entries(input.values).flatMap(([code, raw]) => {
    const game = context.gameByCode.get(code);
    if (!game) return [];

    const amount = raw === null ? 0 : raw;
    if (!Number.isFinite(amount)) {
      throw new ValidationError(`"${code}" received a value that is not a number.`);
    }
    return [{ gameId: game.id, amount }];
  });

  return { siteId: input.siteId, reportDate, values, existingId: existing?.id ?? null };
}

/**
 * Executes a validated plan on the given transaction client.
 *
 * Parameterised over the client so a bulk import can run many of these inside
 * one `$transaction` — a half-applied import is worse than a refused one,
 * because nothing distinguishes it on screen from a complete one.
 *
 * IDEMPOTENT BY CONSTRUCTION. `(siteId, reportDate)` is unique and every value
 * write is an upsert keyed on `(reportId, gameId)`, so re-uploading the same
 * file corrects the rows it names instead of duplicating them.
 */
export async function commitTurnoverUpsert(
  tx: Prisma.TransactionClient,
  ctx: AccessContext,
  plan: TurnoverWritePlan,
): Promise<{ id: string; created: boolean }> {
  const report = plan.existingId
    ? await tx.turnoverReport.update({
        where: { id: plan.existingId },
        data: { deletedAt: null, updatedById: ctx.userId },
        select: { id: true },
      })
    : await tx.turnoverReport.create({
        data: {
          siteId: plan.siteId,
          reportDate: plan.reportDate,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
        select: { id: true },
      });

  for (const value of plan.values) {
    await tx.turnoverValue.upsert({
      where: { reportId_gameId: { reportId: report.id, gameId: value.gameId } },
      create: { reportId: report.id, gameId: value.gameId, amount: value.amount },
      update: { amount: value.amount },
    });
  }

  return { id: report.id, created: plan.existingId === null };
}

export async function upsertTurnover(ctx: AccessContext, input: UpsertTurnoverInput) {
  ctx.requireAnyPermission('turnover.create', 'turnover.update');

  const context = await loadTurnoverPlanContext(ctx, [
    { siteId: input.siteId, reportDate: input.reportDate },
  ]);
  const plan = planTurnoverUpsert(ctx, input, context);

  const result = await unsafeDb.$transaction((tx) =>
    commitTurnoverUpsert(tx, ctx, plan),
  );

  await recordAudit({
    action: result.created ? 'turnover.created' : 'turnover.updated',
    module: 'Turnover',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: input.siteId,
    entityType: 'TurnoverReport',
    entityId: result.id,
    after: { reportDate: input.reportDate, values: input.values },
  });

  return { id: result.id };
}

export async function deleteTurnover(ctx: AccessContext, reportId: string) {
  ctx.requirePermission('turnover.delete');

  const report = await scopedDb(ctx).turnoverReport.findFirst({
    where: scopedWhere(ctx, 'TurnoverReport', { id: reportId, deletedAt: null }),
    select: { id: true, siteId: true, reportDate: true, status: true },
  });

  if (!report) throw new NotFoundError('Report not found.');
  if (report.status === 'LOCKED') {
    throw new ConflictError('That report is locked and cannot be deleted.');
  }

  await unsafeDb.turnoverReport.update({
    where: { id: reportId },
    data: { deletedAt: new Date(), updatedById: ctx.userId },
  });

  await recordAudit({
    action: 'turnover.deleted',
    module: 'Turnover',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: report.siteId,
    entityType: 'TurnoverReport',
    entityId: reportId,
    before: { reportDate: toIsoDate(report.reportDate) },
  });

  return { id: reportId };
}
