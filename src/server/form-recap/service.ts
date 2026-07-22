import { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ValidationError } from '../errors';

/**
 * Form DP/WD recap — a date × site matrix.
 *
 * Rows are the days of the window, columns are the sites, and each cell holds
 * that site's Form Deposit (`form_deposit`) and Form Withdraw (`form_withdraw`)
 * count for the day. A cell is `null` for a metric the site did not enter that
 * day, so the client can render a blank (no report) distinctly from an entered
 * zero — the same distinction the operator's spreadsheet makes.
 *
 * SCALE. One `GROUP BY siteId, reportDate` inside Postgres produces the whole
 * matrix; the result is bounded by sites × days, never by the value rows behind
 * it. Grouping a value row by a field of its *parent report* (`siteId`,
 * `reportDate`) is something Prisma's `groupBy` cannot express, so this is a
 * parameterised `$queryRaw`.
 *
 * RAW QUERIES ARE OUTSIDE THE TRIPWIRE. `scopedDb`'s guard cannot see inside a
 * `$queryRaw`, so the site constraint is written by hand from the same
 * `narrowSiteFilter` result the guarded queries use — and the function returns
 * early on an empty scope rather than emitting `IN ()`.
 */

const MS_PER_DAY = 86_400_000;

/** The two Monthly columns this recap reads, addressed by `MonthlyColumn.key`. */
const FORM_DEPOSIT_KEY = 'form_deposit';
const FORM_WITHDRAW_KEY = 'form_withdraw';

/** Widest window the recap will render; a wider request is clamped to it. */
export const FORM_RECAP_MAX_DAYS = 62;

function fromIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"${value}" bukan tanggal yang valid.`);
  }
  return parsed;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachIsoDate(from: string, to: string): string[] {
  const end = fromIsoDate(to).getTime();
  const dates: string[] = [];
  for (let t = fromIsoDate(from).getTime(); t <= end; t += MS_PER_DAY) {
    dates.push(toIsoDate(new Date(t)));
  }
  return dates;
}

/**
 * Postgres `numeric` arrives as text; `null` means the metric was not entered
 * that day. Parsing keeps an entered zero as `0`, distinct from that `null`.
 */
function toNullableNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface FormRecapSite {
  id: string;
  code: string;
  name: string;
}

export interface FormRecapCell {
  /** Deposit-form count for the day, or null when none was entered. */
  deposit: number | null;
  /** Withdraw-form count for the day, or null when none was entered. */
  withdraw: number | null;
}

export interface FormRecapResult {
  from: string;
  to: string;
  /** Every date in the window, ascending — the matrix rows. */
  dates: string[];
  /** Sites in scope, ordered by name — the matrix columns. */
  sites: FormRecapSite[];
  /** Keyed `${siteId}|${date}`. A missing key means no report that day. */
  cells: Record<string, FormRecapCell>;
}

export interface FormRecapParams {
  from?: string | undefined;
  to?: string | undefined;
}

/** Resolves the window, defaulting to the current month and clamping the width. */
function resolveWindow(params: FormRecapParams): { from: string; to: string } {
  const to = params.to ?? toIsoDate(new Date());
  let from = params.from ?? `${to.slice(0, 7)}-01`;

  if (fromIsoDate(from).getTime() > fromIsoDate(to).getTime()) {
    throw new ValidationError('Tanggal mulai tidak boleh melewati tanggal akhir.');
  }

  const days =
    Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / MS_PER_DAY) +
    1;
  if (days > FORM_RECAP_MAX_DAYS) {
    from = toIsoDate(
      new Date(fromIsoDate(to).getTime() - (FORM_RECAP_MAX_DAYS - 1) * MS_PER_DAY),
    );
  }

  return { from, to };
}

/**
 * The site restriction for the raw statement, applied to `monthly_reports r`.
 *
 * `Prisma.join` emits one bound parameter per id, so identifiers are never
 * spliced into the statement text. `null` means Root with no site filter — the
 * only case that omits the clause; an empty list never reaches here, because the
 * caller returns early rather than emitting `IN ()`.
 */
function siteClause(siteIds: readonly string[] | null): Prisma.Sql {
  if (siteIds === null) return Prisma.empty;
  return Prisma.sql`AND r."siteId" IN (${Prisma.join(
    siteIds.map((id) => Prisma.sql`${id}::uuid`),
  )})`;
}

interface RawRow {
  siteId: string;
  date: string;
  formDeposit: string | null;
  formWithdraw: string | null;
}

/** The per-(site, date) matrix cells for the window, keyed `${siteId}|${date}`. */
async function loadCells(
  siteIds: readonly string[] | null,
  from: string,
  to: string,
): Promise<Record<string, FormRecapCell>> {
  // `[siteId, reportDate]` is unique per report and `[reportId, columnId]` per
  // value, so each group has at most one deposit and one withdraw value; MAX
  // returns it, or NULL (no ELSE) when the metric was not entered that day.
  const rows = await unsafeDb.$queryRaw<RawRow[]>`
    SELECT r."siteId" AS "siteId",
           to_char(r."reportDate", 'YYYY-MM-DD') AS "date",
           MAX(CASE WHEN c."key" = ${FORM_DEPOSIT_KEY}  THEN v."valueNumeric" END)::text AS "formDeposit",
           MAX(CASE WHEN c."key" = ${FORM_WITHDRAW_KEY} THEN v."valueNumeric" END)::text AS "formWithdraw"
      FROM "monthly_values" v
      JOIN "monthly_reports" r ON r."id" = v."reportId"
      JOIN "monthly_columns" c ON c."id" = v."columnId"
     WHERE r."deletedAt" IS NULL
       AND c."deletedAt" IS NULL
       AND r."reportDate" >= ${from}::date
       AND r."reportDate" <= ${to}::date
       AND c."key" IN (${FORM_DEPOSIT_KEY}, ${FORM_WITHDRAW_KEY})
       ${siteClause(siteIds)}
     GROUP BY r."siteId", r."reportDate"
  `;

  const cells: Record<string, FormRecapCell> = {};
  for (const row of rows) {
    cells[`${row.siteId}|${row.date}`] = {
      deposit: toNullableNumber(row.formDeposit),
      withdraw: toNullableNumber(row.formWithdraw),
    };
  }
  return cells;
}

export async function getFormRecap(
  ctx: AccessContext,
  params: FormRecapParams = {},
): Promise<FormRecapResult> {
  ctx.requirePermission('monthly.view');

  const { from, to } = resolveWindow(params);
  const dates = eachIsoDate(from, to);

  // Every active site the caller can see becomes a column, so a site that filed
  // nothing still appears (blank). `narrowSiteFilter(undefined)` is null for Root
  // (no filter) or the caller's own ids.
  const sites = await scopedDb(ctx).site.findMany({
    where: scopedWhere(ctx, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (sites.length === 0) return { from, to, dates, sites: [], cells: {} };

  // Guarded above (`sites` is empty when scope is empty), so `siteIds` here is
  // either null or non-empty — the raw query never sees `IN ()`.
  const siteIds = ctx.narrowSiteFilter(undefined);
  const cells = await loadCells(siteIds, from, to);

  return { from, to, dates, sites, cells };
}
