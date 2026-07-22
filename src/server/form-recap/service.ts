import { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ValidationError } from '../errors';

/**
 * Form DP/WD recap.
 *
 * One row per site: how many deposit forms (`form_deposit`) and withdraw forms
 * (`form_withdraw`) that site filed across the window. Every active site in the
 * caller's scope appears, even one with nothing filed, so the recap doubles as a
 * "who hasn't reported" list rather than silently dropping the empty rows.
 *
 * SCALE. The two per-site sums are computed by one `SUM ... GROUP BY siteId`
 * inside Postgres, mirroring the dashboard's per-site breakdown: `monthly_values`
 * is sized for millions of rows, so this never pulls values into Node to add
 * them up. That aggregate groups a value row by a field of its *parent report*
 * (`siteId`), which Prisma's `groupBy` cannot express, so it is a parameterised
 * `$queryRaw`.
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

/** Widest window the recap will sum; a wider request is clamped to it. */
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

/** Postgres `numeric` arrives as text (see the dashboard); parse it once here. */
function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface FormRecapRow {
  siteId: string;
  code: string;
  name: string;
  /** Count of deposit forms filed in the window. */
  formDeposit: number;
  /** Count of withdraw forms filed in the window. */
  formWithdraw: number;
}

export interface FormRecapResult {
  from: string;
  to: string;
  /** One row per active site in scope, ordered by name. */
  rows: FormRecapRow[];
  /** Grand totals across every row. */
  totals: { formDeposit: number; formWithdraw: number };
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
  formDeposit: string;
  formWithdraw: string;
}

/** Per-site form sums for the window, keyed by siteId. Absent site → no rows. */
async function loadSums(
  siteIds: readonly string[] | null,
  from: string,
  to: string,
): Promise<Map<string, { formDeposit: number; formWithdraw: number }>> {
  const rows = await unsafeDb.$queryRaw<RawRow[]>`
    SELECT r."siteId" AS "siteId",
           COALESCE(SUM(CASE WHEN c."key" = ${FORM_DEPOSIT_KEY}  THEN v."valueNumeric" ELSE 0 END), 0)::text AS "formDeposit",
           COALESCE(SUM(CASE WHEN c."key" = ${FORM_WITHDRAW_KEY} THEN v."valueNumeric" ELSE 0 END), 0)::text AS "formWithdraw"
      FROM "monthly_values" v
      JOIN "monthly_reports" r ON r."id" = v."reportId"
      JOIN "monthly_columns" c ON c."id" = v."columnId"
     WHERE r."deletedAt" IS NULL
       AND c."deletedAt" IS NULL
       AND r."reportDate" >= ${from}::date
       AND r."reportDate" <= ${to}::date
       AND c."key" IN (${FORM_DEPOSIT_KEY}, ${FORM_WITHDRAW_KEY})
       ${siteClause(siteIds)}
     GROUP BY r."siteId"
  `;

  return new Map(
    rows.map((row) => [
      row.siteId,
      {
        formDeposit: toNumber(row.formDeposit),
        formWithdraw: toNumber(row.formWithdraw),
      },
    ]),
  );
}

function emptyResult(from: string, to: string): FormRecapResult {
  return { from, to, rows: [], totals: { formDeposit: 0, formWithdraw: 0 } };
}

export async function getFormRecap(
  ctx: AccessContext,
  params: FormRecapParams = {},
): Promise<FormRecapResult> {
  ctx.requirePermission('monthly.view');

  const { from, to } = resolveWindow(params);

  // Every active site the caller can see becomes a row, so the recap lists the
  // sites that filed nothing too. `narrowSiteFilter(undefined)` is null for Root
  // (no filter) or the caller's own ids.
  const sites = await scopedDb(ctx).site.findMany({
    where: scopedWhere(ctx, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (sites.length === 0) return emptyResult(from, to);

  // Guarded above (`sites` is empty when scope is empty), so `siteIds` here is
  // either null or non-empty — the raw query never sees `IN ()`.
  const siteIds = ctx.narrowSiteFilter(undefined);
  const sums = await loadSums(siteIds, from, to);

  const rows: FormRecapRow[] = sites.map((site) => {
    const agg = sums.get(site.id);
    return {
      siteId: site.id,
      code: site.code,
      name: site.name,
      formDeposit: agg?.formDeposit ?? 0,
      formWithdraw: agg?.formWithdraw ?? 0,
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      formDeposit: acc.formDeposit + row.formDeposit,
      formWithdraw: acc.formWithdraw + row.formWithdraw,
    }),
    { formDeposit: 0, formWithdraw: 0 },
  );

  return { from, to, rows, totals };
}
