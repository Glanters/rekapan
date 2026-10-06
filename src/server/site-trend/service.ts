import { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ValidationError } from '../errors';

import { type Change, comparisonWindows, compareValues } from './compare';

/**
 * Naik Turun Site — which sites rose or fell against the month before, and in
 * which figure.
 *
 * Every site in scope is measured on three families of metric, each summed over
 * the current window and the matching window of the previous month:
 *
 *  - Monthly: every visible, numeric, totalled column that applies to the
 *    site's template. Validasi and Hasil are derived on read in the Monthly
 *    grid (per-bank sum; ADD − SUBTRACT), so they are derived the same way
 *    here — both are linear, so the sum of per-day results equals the result
 *    of the per-period sums.
 *  - Turnover: one metric per active game.
 *  - Kelengkapan: how many days the site filed a Monthly and a Turnover report.
 *
 * RAW QUERIES ARE OUTSIDE THE TRIPWIRE, as in the Rekap Form service: the site
 * constraint is written by hand from `narrowSiteFilter`, and the function
 * returns early on an empty scope rather than emitting `IN ()`.
 */

export const NUMERIC_TYPES = ['CURRENCY', 'DECIMAL', 'INTEGER'] as const;

export type MetricKind = 'monthly' | 'turnover' | 'completeness';

export interface SiteTrendMetric {
  /** Stable within a response: `monthly:<key>`, `turnover:<code>`, `completeness:<x>`. */
  id: string;
  kind: MetricKind;
  label: string;
  /** Heading the metric sits under (column group, game category). */
  group: string | null;
  /** Digits to render with. */
  digits: number;
  current: number;
  previous: number;
  change: Change;
}

export interface SiteTrendSite {
  id: string;
  code: string;
  name: string;
  metrics: SiteTrendMetric[];
  /** Significant rises and falls, by direction. */
  ups: number;
  downs: number;
  /** Significant moves that are bad news — the sort key. */
  worse: number;
}

export interface SiteTrendResult {
  month: string;
  current: { from: string; to: string };
  previous: { from: string; to: string };
  /** False when the previous window is shorter (e.g. Mar 29–31 vs Feb). */
  sameLength: boolean;
  sites: SiteTrendSite[];
}

export function todayIn(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dayCount(from: string, to: string): number {
  return (
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() -
        new Date(`${from}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1
  );
}

function siteClause(siteIds: readonly string[] | null): Prisma.Sql {
  if (siteIds === null) return Prisma.empty;
  return Prisma.sql`AND r."siteId" IN (${Prisma.join(
    siteIds.map((id) => Prisma.sql`${id}::uuid`),
  )})`;
}

/** `(prev, curr)` split of a window pair, as SQL that labels each row's period. */
export function periodCase(
  current: { from: string; to: string },
  previous: { from: string; to: string },
): { label: Prisma.Sql; where: Prisma.Sql } {
  return {
    label: Prisma.sql`CASE WHEN r."reportDate" >= ${current.from}::date THEN 'c' ELSE 'p' END`,
    where: Prisma.sql`((r."reportDate" >= ${current.from}::date AND r."reportDate" <= ${current.to}::date)
       OR (r."reportDate" >= ${previous.from}::date AND r."reportDate" <= ${previous.to}::date))`,
  };
}

interface SumRow {
  siteId: string;
  period: 'c' | 'p';
  ref: string;
  total: string | null;
}

interface CountRow {
  siteId: string;
  period: 'c' | 'p';
  days: bigint | number;
}

type Totals = Map<string, { c: number; p: number }>;

function addTotal(map: Totals, key: string, period: 'c' | 'p', value: number): void {
  const entry = map.get(key) ?? { c: 0, p: 0 };
  entry[period] += value;
  map.set(key, entry);
}

export async function getSiteTrend(
  ctx: AccessContext,
  params: { month?: string | undefined } = {},
): Promise<SiteTrendResult> {
  ctx.requirePermission('dashboard.view');

  const today = todayIn('Asia/Jakarta');
  const month = params.month ?? today.slice(0, 7);
  const windows = comparisonWindows(month, today);
  if (!windows) {
    throw new ValidationError('Bulan tidak valid atau belum berjalan.');
  }
  const { current, previous } = windows;
  const curDays = dayCount(current.from, current.to);
  const prevDays = dayCount(previous.from, previous.to);
  const sameLength = curDays === prevDays;

  const empty: SiteTrendResult = { month, current, previous, sameLength, sites: [] };

  const sites = await scopedDb(ctx).site.findMany({
    where: scopedWhere(ctx, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true, templateId: true },
    orderBy: { name: 'asc' },
  });
  if (sites.length === 0) return empty;

  // Non-empty here, so the raw statements never see `IN ()`.
  const siteIds = ctx.narrowSiteFilter(undefined);
  const period = periodCase(current, previous);
  const canMonthly = ctx.can('monthly.view');
  const canTurnover = ctx.can('turnover.view');

  const [
    columns,
    games,
    monthlySums,
    validationSums,
    turnoverSums,
    monthlyDays,
    turnoverDays,
  ] = await Promise.all([
    canMonthly
      ? unsafeDb.monthlyColumn.findMany({
          where: {
            deletedAt: null,
            isVisible: true,
            OR: [
              { includeInTotals: true, dataType: { in: [...NUMERIC_TYPES] } },
              { resultEffect: 'RESULT' },
            ],
          },
          select: {
            id: true,
            key: true,
            label: true,
            group: true,
            precision: true,
            templateId: true,
            resultEffect: true,
            computation: true,
          },
          orderBy: { position: 'asc' },
        })
      : Promise.resolve([]),
    canTurnover
      ? unsafeDb.turnoverGame.findMany({
          where: { deletedAt: null, isActive: true },
          select: { id: true, code: true, name: true, category: true },
          orderBy: { position: 'asc' },
        })
      : Promise.resolve([]),
    canMonthly
      ? unsafeDb.$queryRaw<SumRow[]>`
            SELECT r."siteId" AS "siteId", ${period.label} AS "period",
                   v."columnId"::text AS "ref", SUM(v."valueNumeric")::text AS "total"
              FROM "monthly_values" v
              JOIN "monthly_reports" r ON r."id" = v."reportId"
             WHERE r."deletedAt" IS NULL AND ${period.where} ${siteClause(siteIds)}
             GROUP BY 1, 2, 3`
      : Promise.resolve([]),
    canMonthly
      ? unsafeDb.$queryRaw<SumRow[]>`
            SELECT r."siteId" AS "siteId", ${period.label} AS "period",
                   'validasi' AS "ref", SUM(mv."memberCount")::text AS "total"
              FROM "monthly_validations" mv
              JOIN "monthly_reports" r ON r."id" = mv."reportId"
             WHERE r."deletedAt" IS NULL AND ${period.where} ${siteClause(siteIds)}
             GROUP BY 1, 2`
      : Promise.resolve([]),
    canTurnover
      ? unsafeDb.$queryRaw<SumRow[]>`
            SELECT r."siteId" AS "siteId", ${period.label} AS "period",
                   v."gameId"::text AS "ref", SUM(v."amount")::text AS "total"
              FROM "turnover_values" v
              JOIN "turnover_reports" r ON r."id" = v."reportId"
             WHERE r."deletedAt" IS NULL AND ${period.where} ${siteClause(siteIds)}
             GROUP BY 1, 2, 3`
      : Promise.resolve([]),
    canMonthly
      ? unsafeDb.$queryRaw<CountRow[]>`
            SELECT r."siteId" AS "siteId", ${period.label} AS "period", COUNT(*) AS "days"
              FROM "monthly_reports" r
             WHERE r."deletedAt" IS NULL AND ${period.where} ${siteClause(siteIds)}
             GROUP BY 1, 2`
      : Promise.resolve([]),
    canTurnover
      ? unsafeDb.$queryRaw<CountRow[]>`
            SELECT r."siteId" AS "siteId", ${period.label} AS "period", COUNT(*) AS "days"
              FROM "turnover_reports" r
             WHERE r."deletedAt" IS NULL AND ${period.where} ${siteClause(siteIds)}
             GROUP BY 1, 2`
      : Promise.resolve([]),
  ]);

  // site|ref → totals per period.
  const sums: Totals = new Map();
  for (const row of [...monthlySums, ...turnoverSums]) {
    addTotal(sums, `${row.siteId}|${row.ref}`, row.period, Number(row.total ?? 0));
  }
  const validasi: Totals = new Map();
  for (const row of validationSums) {
    addTotal(validasi, row.siteId, row.period, Number(row.total ?? 0));
  }
  const filed = new Map<string, { c: number; p: number }>();
  for (const [prefix, rows] of [
    ['m', monthlyDays],
    ['t', turnoverDays],
  ] as const) {
    for (const row of rows) {
      addTotal(filed, `${row.siteId}|${prefix}`, row.period, Number(row.days));
    }
  }

  /**
   * Builds one metric. When the two windows differ in length the change is
   * judged per day, so a 31-day month is not credited for three extra days.
   */
  const metric = (
    base: Omit<SiteTrendMetric, 'change'>,
    higherIsWorse = false,
  ): SiteTrendMetric => {
    const cur = sameLength ? base.current : base.current / curDays;
    const prev = sameLength ? base.previous : base.previous / prevDays;
    return { ...base, change: compareValues(cur, prev, higherIsWorse) };
  };

  const result: SiteTrendSite[] = sites.map((site) => {
    const metrics: SiteTrendMetric[] = [];

    // Monthly columns applicable to this site's template.
    const applicable = columns.filter(
      (c) => c.templateId === null || c.templateId === site.templateId,
    );
    const valueOf = (column: (typeof columns)[number]) =>
      (column.computation === 'VALIDATION_TOTAL'
        ? validasi.get(site.id)
        : sums.get(`${site.id}|${column.id}`)) ?? { c: 0, p: 0 };

    const hasil = { c: 0, p: 0 };
    for (const column of applicable) {
      if (column.resultEffect === 'RESULT') continue;
      const v = valueOf(column);
      if (column.resultEffect === 'ADD') {
        hasil.c += v.c;
        hasil.p += v.p;
      } else if (column.resultEffect === 'SUBTRACT') {
        hasil.c -= v.c;
        hasil.p -= v.p;
      }
    }

    for (const column of applicable) {
      const v = column.resultEffect === 'RESULT' ? hasil : valueOf(column);
      if (v.c === 0 && v.p === 0) continue;
      metrics.push(
        metric(
          {
            id: `monthly:${column.key}`,
            kind: 'monthly',
            label: column.label,
            group: column.group,
            digits: column.precision,
            current: v.c,
            previous: v.p,
          },
          // A figure that is subtracted from the result (a withdraw, a loan)
          // is the one where growth is bad news.
          column.resultEffect === 'SUBTRACT',
        ),
      );
    }

    for (const game of games) {
      const v = sums.get(`${site.id}|${game.id}`);
      if (!v || (v.c === 0 && v.p === 0)) continue;
      metrics.push(
        metric({
          id: `turnover:${game.code}`,
          kind: 'turnover',
          label: game.name,
          group: game.category,
          digits: 2,
          current: v.c,
          previous: v.p,
        }),
      );
    }

    // Filing days compare raw: they are already counts of days, and a shorter
    // previous window is exactly what the per-day rule would double-correct.
    const completeness = (
      key: string,
      label: string,
      v: { c: number; p: number } | undefined,
    ) => {
      const c = v?.c ?? 0;
      const p = v?.p ?? 0;
      metrics.push({
        id: `completeness:${key}`,
        kind: 'completeness',
        label,
        group: 'Kelengkapan',
        digits: 0,
        current: c,
        previous: p,
        change: compareValues(c / curDays, p / prevDays),
      });
    };
    if (canMonthly)
      completeness('monthly', 'Hari input Monthly', filed.get(`${site.id}|m`));
    if (canTurnover) {
      completeness('turnover', 'Hari input Turnover', filed.get(`${site.id}|t`));
    }

    const moved = metrics.filter((m) => m.change.significant);
    return {
      id: site.id,
      code: site.code,
      name: site.name,
      metrics,
      ups: moved.filter(
        (m) => m.change.direction === 'up' || m.change.direction === 'new',
      ).length,
      downs: moved.filter(
        (m) => m.change.direction === 'down' || m.change.direction === 'gone',
      ).length,
      worse: moved.filter((m) => m.change.favourable === false).length,
    };
  });

  return { ...empty, sites: result };
}
