import { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ValidationError } from '../errors';
import {
  DASHBOARD_DEFAULT_RANGE_DAYS,
  DASHBOARD_MAX_RANGE_DAYS,
  type DashboardQuery,
} from './schema';

/**
 * Dashboard rollups.
 *
 * SCALE IS THE WHOLE DESIGN. `monthly_values` and `turnover_values` are sized
 * for millions of rows, so nothing here loads rows and reduces them in Node:
 * every figure on the page is produced by a `groupBy` or a `SUM` that runs
 * inside Postgres, and what crosses the process boundary is one aggregate per
 * bucket. Pulling a range of values into memory to add them up is the exact
 * failure mode the EAV schema and its `(columnId, reportId)` covering index
 * were built to avoid.
 *
 * WHY SOME QUERIES ARE RAW. Prisma's `groupBy` can only group by columns of the
 * model being queried. The daily series and the per-site breakdown group a
 * value row by a field of its *parent report* (`reportDate`, `siteId`), which
 * `groupBy` cannot express — the alternative would be fetching the values and
 * bucketing them here, which is the thing this module refuses to do. Those two
 * queries are therefore `$queryRaw`, fully parameterised: every caller-supplied
 * value is a bound parameter, never interpolated into the statement.
 *
 * RAW QUERIES ARE OUTSIDE THE TRIPWIRE. `scopedDb`'s guard intercepts model
 * operations; it cannot see inside a `$queryRaw`. The site constraint in those
 * two statements is therefore written by hand, from the same
 * `ctx.narrowSiteFilter` result the guarded queries use, and this module
 * returns early when that result is empty rather than emitting an `IN ()`.
 */

// ============================================================================
// COLUMN RESOLUTION
// ============================================================================

/**
 * The Monthly columns the headline figures are built from, addressed by
 * `MonthlyColumn.key`.
 *
 * Keys, never positions: columns are rows that administrators reorder and
 * insert between at will, so an index into the column list is a figure that
 * silently starts reporting something else the first time someone drags a
 * column. A key that no longer exists yields zero, which is visible.
 */
const COLUMN_KEYS = {
  deposit: 'deposit',
  withdraw: 'withdraw',
  turnover: 'turnover',
  bet: 'pl_bet',
  validasi: 'validasi',
} as const;

type TotalKey = keyof typeof COLUMN_KEYS;

const TOTAL_KEYS = Object.keys(COLUMN_KEYS) as readonly TotalKey[];

/** Every `MonthlyColumn.key` this module reads, for the `IN` lists below. */
const TRACKED_COLUMN_KEYS: readonly string[] = Object.values(COLUMN_KEYS);

// ============================================================================
// PUBLIC SHAPE
// ============================================================================

export interface DashboardRange {
  from: string;
  to: string;
  /** Inclusive day count; also the length of the comparison period. */
  days: number;
}

export interface DashboardTotals {
  deposit: number;
  withdraw: number;
  /** Derived, not stored: deposit − withdraw. */
  profit: number;
  turnover: number;
  bet: number;
  validasi: number;
}

export interface DashboardSeriesPoint {
  /** ISO date, no time component. */
  date: string;
  deposit: number;
  withdraw: number;
  turnover: number;
}

export interface DashboardSiteBreakdown {
  siteId: string;
  code: string;
  name: string;
  turnover: number;
  profit: number;
}

export interface DashboardTopGame {
  gameId: string;
  code: string;
  name: string;
  category: string | null;
  turnover: number;
}

export interface DashboardActivity {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  action: string;
  module: string;
  entityType: string | null;
}

export interface DashboardData {
  range: DashboardRange;
  /** The equally long window immediately before `range`, for the deltas. */
  previousRange: DashboardRange;
  totals: DashboardTotals;
  previousTotals: DashboardTotals;
  series: DashboardSeriesPoint[];
  bySite: DashboardSiteBreakdown[];
  topGames: DashboardTopGame[];
  activity: DashboardActivity[];
  /** Lets the client tell "nothing in this range" apart from "nothing at all". */
  coverage: {
    monthlyReports: number;
    turnoverReports: number;
    hasAnyMonthly: boolean;
    hasAnyTurnover: boolean;
  };
}

// ============================================================================
// DATES
// ============================================================================

const MS_PER_DAY = 86_400_000;

/** Parses `YYYY-MM-DD` into the UTC midnight Postgres stores for a `date`. */
function fromIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"${value}" bukan tanggal yang valid.`);
  }
  return parsed;
}

/** `@db.Date` values are UTC midnight; formatting by UTC parts avoids a shift. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  return toIsoDate(new Date(fromIsoDate(iso).getTime() + days * MS_PER_DAY));
}

function dayCount(from: string, to: string): number {
  return (
    Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / MS_PER_DAY) +
    1
  );
}

/**
 * Resolves the requested window, applying the defaults and the hard ceiling.
 *
 * Clamping moves `from` forward rather than rejecting the request: the ceiling
 * exists to bound the query, and silently narrowing an over-wide range is
 * friendlier than a 400 for a cap the user never saw.
 */
export function resolveRange(
  query: DashboardQuery,
  today = new Date(),
): DashboardRange {
  const to = query.to ?? toIsoDate(today);
  const from = query.from ?? shiftDays(to, -(DASHBOARD_DEFAULT_RANGE_DAYS - 1));

  if (fromIsoDate(from).getTime() > fromIsoDate(to).getTime()) {
    throw new ValidationError('Tanggal mulai tidak boleh melewati tanggal akhir.');
  }

  const days = dayCount(from, to);
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    const clamped = shiftDays(to, -(DASHBOARD_MAX_RANGE_DAYS - 1));
    return { from: clamped, to, days: DASHBOARD_MAX_RANGE_DAYS };
  }

  return { from, to, days };
}

/** Every date in the window, so the chart's x-axis has no invisible gaps. */
function eachIsoDate(range: DashboardRange): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < range.days; offset += 1) {
    dates.push(shiftDays(range.from, offset));
  }
  return dates;
}

// ============================================================================
// NUMBERS
// ============================================================================

/**
 * The single conversion point for Postgres `numeric`.
 *
 * `Decimal(20, 4)` is exact in the database and has no JSON representation, so
 * it cannot cross the wire as itself. Aggregates are cast to `text` in SQL and
 * parsed here — once, at the service boundary — rather than being handed to the
 * client as an object it would have to know how to read. Everything downstream
 * deals in plain numbers.
 */
function toNumber(value: string | number | Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyTotals(): DashboardTotals {
  return { deposit: 0, withdraw: 0, profit: 0, turnover: 0, bet: 0, validasi: 0 };
}

// ============================================================================
// SQL FRAGMENTS
// ============================================================================

/**
 * The site restriction for the raw statements, applied to `monthly_reports r`.
 *
 * `Prisma.join` emits one bound parameter per id, so the identifiers are never
 * spliced into the statement text — and the column is a literal in this file,
 * not a caller-supplied name. `null` means Root with no site filter, the only
 * case that legitimately omits the clause; an empty list never reaches here,
 * because `getDashboard` returns early rather than emitting `IN ()`.
 */
function siteClause(siteIds: readonly string[] | null): Prisma.Sql {
  if (siteIds === null) return Prisma.empty;
  return Prisma.sql`AND r."siteId" IN (${Prisma.join(
    siteIds.map((id) => Prisma.sql`${id}::uuid`),
  )})`;
}

/**
 * `key IN (...)` over the tracked column keys.
 *
 * The values are module constants rather than user input, but they are bound
 * as parameters anyway — a literal that is safe today becomes an injection the
 * moment someone makes the list configurable.
 */
const trackedKeysList = Prisma.join(
  TRACKED_COLUMN_KEYS.map((key) => Prisma.sql`${key}`),
);

/** `SUM(...)` restricted to one column key, cast to text. See {@link toNumber}. */
function sumForKey(key: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(CASE WHEN c."key" = ${key} THEN v."valueNumeric" ELSE 0 END), 0)`;
}

// ============================================================================
// AGGREGATES
// ============================================================================

interface RawSeriesRow {
  date: string;
  deposit: string;
  withdraw: string;
  turnover: string;
}

interface RawSiteRow {
  siteId: string;
  code: string;
  name: string;
  turnover: string;
  deposit: string;
  withdraw: string;
}

/**
 * Headline totals, one `groupBy` per period.
 *
 * This one runs through `scopedDb`, so the tripwire verifies the site
 * constraint: `scopedWhere` AND-s `{ report: { siteId: { in } } }` onto the
 * filter, which is the shape `hasSiteConstraint` accepts for a relation-scoped
 * model.
 */
async function loadTotals(
  ctx: AccessContext,
  columnIdByKey: ReadonlyMap<string, string>,
  siteIds: readonly string[] | null,
  range: DashboardRange,
): Promise<DashboardTotals> {
  const columnIds = [...columnIdByKey.values()];
  if (columnIds.length === 0) return emptyTotals();

  const grouped = await scopedDb(ctx).monthlyValue.groupBy({
    by: ['columnId'],
    where: scopedWhere(ctx, 'MonthlyValue', {
      columnId: { in: columnIds },
      report: {
        deletedAt: null,
        reportDate: { gte: fromIsoDate(range.from), lte: fromIsoDate(range.to) },
        ...(siteIds ? { siteId: { in: [...siteIds] } } : {}),
      },
    }),
    _sum: { valueNumeric: true },
  });

  const sumByColumnId = new Map(
    grouped.map((row) => [row.columnId, toNumber(row._sum.valueNumeric)]),
  );

  const totals = emptyTotals();
  for (const totalKey of TOTAL_KEYS) {
    const columnId = columnIdByKey.get(COLUMN_KEYS[totalKey]);
    totals[totalKey] = columnId ? (sumByColumnId.get(columnId) ?? 0) : 0;
  }

  // Profit is not a stored column: the seed ships a `hasil` column, but it is
  // hand-entered and may disagree with the arithmetic. Deriving it keeps the
  // card consistent with the two cards beside it.
  totals.profit = totals.deposit - totals.withdraw;
  return totals;
}

/**
 * Daily deposit, withdraw, and turnover.
 *
 * One statement, three conditional sums, one row per day — grouping by the
 * parent report's date, which is why this is raw rather than a `groupBy`.
 */
async function loadSeries(
  siteIds: readonly string[] | null,
  range: DashboardRange,
): Promise<DashboardSeriesPoint[]> {
  const rows = await unsafeDb.$queryRaw<RawSeriesRow[]>`
    SELECT to_char(r."reportDate", 'YYYY-MM-DD')        AS "date",
           ${sumForKey(COLUMN_KEYS.deposit)}::text      AS "deposit",
           ${sumForKey(COLUMN_KEYS.withdraw)}::text     AS "withdraw",
           ${sumForKey(COLUMN_KEYS.turnover)}::text     AS "turnover"
      FROM "monthly_values" v
      JOIN "monthly_reports" r ON r."id" = v."reportId"
      JOIN "monthly_columns" c ON c."id" = v."columnId"
     WHERE r."deletedAt" IS NULL
       AND c."deletedAt" IS NULL
       AND r."reportDate" >= ${range.from}::date
       AND r."reportDate" <= ${range.to}::date
       AND c."key" IN (${trackedKeysList})
       ${siteClause(siteIds)}
     GROUP BY r."reportDate"
     ORDER BY r."reportDate" ASC
  `;

  const byDate = new Map(rows.map((row) => [row.date, row]));

  // Days with no report become explicit zeros. A line that simply skips them
  // draws a straight segment across the gap, which reads as "flat" rather than
  // "nothing was reported".
  return eachIsoDate(range).map((date) => {
    const row = byDate.get(date);
    return {
      date,
      deposit: toNumber(row?.deposit),
      withdraw: toNumber(row?.withdraw),
      turnover: toNumber(row?.turnover),
    };
  });
}

/**
 * Turnover and profit per site.
 *
 * Both figures come from Monthly rather than the Turnover module, so the
 * breakdown adds up to the headline cards above it. The per-game split in
 * {@link loadTopGames} is the one figure that has to come from `turnover_values`,
 * because that is the only place the game dimension exists.
 *
 * Ranking and the cut-off happen in SQL: the chart shows the leaders, and
 * deciding who leads by sorting a materialised list in Node would defeat the
 * point of aggregating in the database.
 */
async function loadBySite(
  siteIds: readonly string[] | null,
  range: DashboardRange,
): Promise<DashboardSiteBreakdown[]> {
  const rows = await unsafeDb.$queryRaw<RawSiteRow[]>`
    SELECT s."id"                                    AS "siteId",
           s."code"                                  AS "code",
           s."name"                                  AS "name",
           ${sumForKey(COLUMN_KEYS.turnover)}::text  AS "turnover",
           ${sumForKey(COLUMN_KEYS.deposit)}::text   AS "deposit",
           ${sumForKey(COLUMN_KEYS.withdraw)}::text  AS "withdraw"
      FROM "monthly_values" v
      JOIN "monthly_reports" r ON r."id" = v."reportId"
      JOIN "monthly_columns" c ON c."id" = v."columnId"
      JOIN "sites" s           ON s."id" = r."siteId"
     WHERE r."deletedAt" IS NULL
       AND c."deletedAt" IS NULL
       AND s."deletedAt" IS NULL
       AND r."reportDate" >= ${range.from}::date
       AND r."reportDate" <= ${range.to}::date
       AND c."key" IN (${trackedKeysList})
       ${siteClause(siteIds)}
     GROUP BY s."id", s."code", s."name"
     ORDER BY ${sumForKey(COLUMN_KEYS.turnover)} DESC, s."name" ASC
     LIMIT 25
  `;

  return rows.map((row) => ({
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    turnover: toNumber(row.turnover),
    profit: toNumber(row.deposit) - toNumber(row.withdraw),
  }));
}

/**
 * Highest-turnover games in the window.
 *
 * Guarded rather than raw: `turnover_values` carries `gameId` itself, so
 * `groupBy` can express this one and the tripwire gets to check it.
 */
async function loadTopGames(
  ctx: AccessContext,
  siteIds: readonly string[] | null,
  range: DashboardRange,
): Promise<DashboardTopGame[]> {
  const grouped = await scopedDb(ctx).turnoverValue.groupBy({
    by: ['gameId'],
    where: scopedWhere(ctx, 'TurnoverValue', {
      report: {
        deletedAt: null,
        reportDate: { gte: fromIsoDate(range.from), lte: fromIsoDate(range.to) },
        ...(siteIds ? { siteId: { in: [...siteIds] } } : {}),
      },
    }),
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 8,
  });

  if (grouped.length === 0) return [];

  // `TurnoverGame` is master data, not site-owned, so it is read unscoped —
  // the same call `turnover/service.ts` makes for the table headers.
  const games = await unsafeDb.turnoverGame.findMany({
    where: { id: { in: grouped.map((row) => row.gameId) } },
    select: { id: true, code: true, name: true, category: true },
  });
  const gameById = new Map(games.map((game) => [game.id, game]));

  return grouped.flatMap((row) => {
    const game = gameById.get(row.gameId);
    // A value whose game was hard-deleted has no label to render under, so it
    // is dropped rather than charted as a blank bar.
    if (!game) return [];
    return [
      {
        gameId: game.id,
        code: game.code,
        name: game.name,
        category: game.category,
        turnover: toNumber(row._sum.amount),
      },
    ];
  });
}

/**
 * The recent-activity feed.
 *
 * The visibility rule is copied from `audit/service.ts` deliberately, including
 * the `siteId: null` branch: user administration, role changes, settings, and
 * sign-ins all record no site, so a site-only rule leaves the feed empty for
 * everyone except Root.
 *
 * The projection is narrower than the audit page's, though. This endpoint is
 * gated on `dashboard.view`, which far more roles hold than `audit.view`, so it
 * returns only the summary line — never the `before`/`after` diff, the IP, or
 * the request id. Reading those still means going to the audit page and holding
 * the permission it requires.
 */
async function loadActivity(
  ctx: AccessContext,
  range: DashboardRange,
): Promise<DashboardActivity[]> {
  const where: Prisma.AuditLogWhereInput = {
    createdAt: {
      gte: fromIsoDate(range.from),
      // Exclusive upper bound at the next UTC midnight, so the last day of the
      // window is included whole rather than cut off at 00:00.
      lt: fromIsoDate(shiftDays(range.to, 1)),
    },
  };

  if (!ctx.isRoot) {
    where.OR = [{ siteId: null }, { siteId: { in: [...(ctx.siteIds ?? [])] } }];
  }

  const entries = await unsafeDb.auditLog.findMany({
    where,
    select: {
      id: true,
      createdAt: true,
      actorEmail: true,
      action: true,
      module: true,
      entityType: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });

  return entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    actorEmail: entry.actorEmail,
    action: entry.action,
    module: entry.module,
    entityType: entry.entityType,
  }));
}

// ============================================================================
// ENTRY POINT
// ============================================================================

function emptyDashboard(
  range: DashboardRange,
  previousRange: DashboardRange,
): DashboardData {
  return {
    range,
    previousRange,
    totals: emptyTotals(),
    previousTotals: emptyTotals(),
    series: eachIsoDate(range).map((date) => ({
      date,
      deposit: 0,
      withdraw: 0,
      turnover: 0,
    })),
    bySite: [],
    topGames: [],
    activity: [],
    coverage: {
      monthlyReports: 0,
      turnoverReports: 0,
      hasAnyMonthly: false,
      hasAnyTurnover: false,
    },
  };
}

export async function getDashboard(
  ctx: AccessContext,
  query: DashboardQuery = {},
): Promise<DashboardData> {
  ctx.requirePermission('dashboard.view');

  const range = resolveRange(query);
  const previousRange: DashboardRange = {
    from: shiftDays(range.from, -range.days),
    to: shiftDays(range.from, -1),
    days: range.days,
  };

  // `null` means Root with no site filter — every site. An empty array means
  // the caller reaches nothing, either because no site is assigned or because
  // they picked one they cannot see; the site picker is user input, not an
  // attack, so that narrows to nothing rather than raising.
  const siteIds = ctx.narrowSiteFilter(query.siteId ? [query.siteId] : undefined);

  if (siteIds !== null && siteIds.length === 0) {
    return emptyDashboard(range, previousRange);
  }

  const columns = await unsafeDb.monthlyColumn.findMany({
    where: { key: { in: [...TRACKED_COLUMN_KEYS] }, deletedAt: null },
    select: { id: true, key: true },
  });
  const columnIdByKey = new Map(columns.map((column) => [column.key, column.id]));

  const db = scopedDb(ctx);
  const reportRange = {
    reportDate: { gte: fromIsoDate(range.from), lte: fromIsoDate(range.to) },
  };
  const inScope = siteIds ? { siteId: { in: [...siteIds] } } : {};

  const [
    totals,
    previousTotals,
    series,
    bySite,
    topGames,
    activity,
    monthlyReports,
    turnoverReports,
    anyMonthly,
    anyTurnover,
  ] = await Promise.all([
    loadTotals(ctx, columnIdByKey, siteIds, range),
    loadTotals(ctx, columnIdByKey, siteIds, previousRange),
    loadSeries(siteIds, range),
    loadBySite(siteIds, range),
    loadTopGames(ctx, siteIds, range),
    loadActivity(ctx, range),
    db.monthlyReport.count({
      where: scopedWhere(ctx, 'MonthlyReport', {
        deletedAt: null,
        ...inScope,
        ...reportRange,
      }),
    }),
    db.turnoverReport.count({
      where: scopedWhere(ctx, 'TurnoverReport', {
        deletedAt: null,
        ...inScope,
        ...reportRange,
      }),
    }),
    // Range-independent existence probes, so the UI can say "nothing in this
    // period" instead of "nothing has ever been entered" when only the filter
    // is wrong. `findFirst` rather than `count`: the answer is a boolean, and
    // counting a table that may hold millions of rows to produce one is waste.
    db.monthlyReport.findFirst({
      where: scopedWhere(ctx, 'MonthlyReport', { deletedAt: null }),
      select: { id: true },
    }),
    db.turnoverReport.findFirst({
      where: scopedWhere(ctx, 'TurnoverReport', { deletedAt: null }),
      select: { id: true },
    }),
  ]);

  return {
    range,
    previousRange,
    totals,
    previousTotals,
    series,
    bySite,
    topGames,
    activity,
    coverage: {
      monthlyReports,
      turnoverReports,
      hasAnyMonthly: anyMonthly !== null,
      hasAnyTurnover: anyTurnover !== null,
    },
  };
}
