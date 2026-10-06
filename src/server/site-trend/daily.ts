import { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ValidationError } from '../errors';

import { comparisonWindows } from './compare';
import { type MetricKind, NUMERIC_TYPES, periodCase, todayIn } from './service';

/**
 * Day-by-day figures for one site, both months side by side, for every metric
 * the monthly comparison shows. Loaded on demand when a site is opened, so the
 * list page never carries sites × metrics × days.
 */

export interface SiteTrendDailyMetric {
  /** Same id as the metric in the monthly comparison. */
  id: string;
  kind: MetricKind;
  label: string;
  group: string | null;
  digits: number;
  higherIsWorse: boolean;
  /** Index `d - 1` holds day `d`; null means nothing was filed that day. */
  current: (number | null)[];
  previous: (number | null)[];
}

export interface SiteTrendDailyResult {
  month: string;
  current: { from: string; to: string };
  previous: { from: string; to: string };
  site: { id: string; code: string; name: string };
  /** Day-of-month numbers, 1…n — the rows. */
  days: number[];
  metrics: SiteTrendDailyMetric[];
}

interface DayRow {
  date: string;
  ref: string;
  total: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Series = { c: (number | null)[]; p: (number | null)[] };

export async function getSiteTrendDaily(
  ctx: AccessContext,
  params: { siteId: string; month?: string | undefined },
): Promise<SiteTrendDailyResult> {
  ctx.requirePermission('dashboard.view');
  // Checked before it reaches a `::uuid` cast, which would fail as a 500.
  if (!UUID.test(params.siteId)) throw new ValidationError('Site tidak valid.');
  ctx.requireSite(params.siteId);

  const today = todayIn('Asia/Jakarta');
  const month = params.month ?? today.slice(0, 7);
  const windows = comparisonWindows(month, today);
  if (!windows) {
    throw new ValidationError('Bulan tidak valid atau belum berjalan.');
  }
  const { current, previous } = windows;

  const site = await scopedDb(ctx).site.findFirst({
    where: scopedWhere(ctx, 'Site', { id: params.siteId, deletedAt: null }),
    select: { id: true, code: true, name: true, templateId: true },
  });
  if (!site) throw new ValidationError('Site tidak ditemukan.');

  const days = Array.from({ length: windows.days }, (_, i) => i + 1);
  const period = periodCase(current, previous);
  const only = Prisma.sql`AND r."siteId" = ${site.id}::uuid`;
  const day = Prisma.sql`to_char(r."reportDate", 'YYYY-MM-DD')`;
  const canMonthly = ctx.can('monthly.view');
  const canTurnover = ctx.can('turnover.view');

  const [columns, games, ...rowGroups] = await Promise.all([
    canMonthly
      ? unsafeDb.monthlyColumn.findMany({
          where: {
            deletedAt: null,
            isVisible: true,
            AND: [
              {
                OR: [
                  { templateId: null },
                  { templateId: site.templateId ?? undefined },
                ],
              },
              {
                OR: [
                  { includeInTotals: true, dataType: { in: [...NUMERIC_TYPES] } },
                  { resultEffect: 'RESULT' },
                ],
              },
            ],
          },
          select: {
            id: true,
            key: true,
            label: true,
            group: true,
            precision: true,
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
      ? unsafeDb.$queryRaw<DayRow[]>`
          SELECT ${day} AS "date", v."columnId"::text AS "ref",
                 SUM(v."valueNumeric")::text AS "total"
            FROM "monthly_values" v
            JOIN "monthly_reports" r ON r."id" = v."reportId"
           WHERE r."deletedAt" IS NULL AND ${period.where} ${only}
           GROUP BY 1, 2`
      : Promise.resolve([]),
    canMonthly
      ? unsafeDb.$queryRaw<DayRow[]>`
          SELECT ${day} AS "date", 'validasi' AS "ref",
                 SUM(mv."memberCount")::text AS "total"
            FROM "monthly_validations" mv
            JOIN "monthly_reports" r ON r."id" = mv."reportId"
           WHERE r."deletedAt" IS NULL AND ${period.where} ${only}
           GROUP BY 1`
      : Promise.resolve([]),
    canTurnover
      ? unsafeDb.$queryRaw<DayRow[]>`
          SELECT ${day} AS "date", v."gameId"::text AS "ref",
                 SUM(v."amount")::text AS "total"
            FROM "turnover_values" v
            JOIN "turnover_reports" r ON r."id" = v."reportId"
           WHERE r."deletedAt" IS NULL AND ${period.where} ${only}
           GROUP BY 1, 2`
      : Promise.resolve([]),
    canMonthly
      ? unsafeDb.$queryRaw<DayRow[]>`
          SELECT ${day} AS "date", 'filed:m' AS "ref", '1' AS "total"
            FROM "monthly_reports" r
           WHERE r."deletedAt" IS NULL AND ${period.where} ${only}`
      : Promise.resolve([]),
    canTurnover
      ? unsafeDb.$queryRaw<DayRow[]>`
          SELECT ${day} AS "date", 'filed:t' AS "ref", '1' AS "total"
            FROM "turnover_reports" r
           WHERE r."deletedAt" IS NULL AND ${period.where} ${only}`
      : Promise.resolve([]),
  ]);

  const blank = (): Series => ({ c: days.map(() => null), p: days.map(() => null) });

  // ref → per-day values for each month, null where nothing was filed.
  const series = new Map<string, Series>();
  for (const row of (rowGroups as DayRow[][]).flat()) {
    const index = Number(row.date.slice(8, 10)) - 1;
    // A value row with no number is a blank cell, not a zero.
    if (row.total === null || index < 0 || index >= days.length) continue;
    let entry = series.get(row.ref);
    if (!entry) {
      entry = blank();
      series.set(row.ref, entry);
    }
    entry[row.date >= current.from ? 'c' : 'p'][index] = Number(row.total);
  }

  const valueOf = (column: (typeof columns)[number]): Series =>
    series.get(column.computation === 'VALIDATION_TOTAL' ? 'validasi' : column.id) ??
    blank();

  // Hasil per day, from the same ADD / SUBTRACT contributions the Monthly grid
  // uses; null on a day none of them was filed.
  const hasil = blank();
  for (const column of columns) {
    if (column.resultEffect !== 'ADD' && column.resultEffect !== 'SUBTRACT') continue;
    const sign = column.resultEffect === 'ADD' ? 1 : -1;
    const v = valueOf(column);
    for (const slot of ['c', 'p'] as const) {
      v[slot].forEach((value, i) => {
        if (value !== null) hasil[slot][i] = (hasil[slot][i] ?? 0) + sign * value;
      });
    }
  }

  const hasAny = (v: Series) =>
    v.c.some((x) => x !== null && x !== 0) || v.p.some((x) => x !== null && x !== 0);

  const metrics: SiteTrendDailyMetric[] = [];
  for (const column of columns) {
    const v = column.resultEffect === 'RESULT' ? hasil : valueOf(column);
    if (!hasAny(v)) continue;
    metrics.push({
      id: `monthly:${column.key}`,
      kind: 'monthly',
      label: column.label,
      group: column.group,
      digits: column.precision,
      higherIsWorse: column.resultEffect === 'SUBTRACT',
      current: v.c,
      previous: v.p,
    });
  }
  for (const game of games) {
    const v = series.get(game.id);
    if (!v || !hasAny(v)) continue;
    metrics.push({
      id: `turnover:${game.code}`,
      kind: 'turnover',
      label: game.name,
      group: game.category,
      digits: 2,
      higherIsWorse: false,
      current: v.c,
      previous: v.p,
    });
  }
  const filing: [string, string, string, boolean][] = [
    ['monthly', 'Hari input Monthly', 'filed:m', canMonthly],
    ['turnover', 'Hari input Turnover', 'filed:t', canTurnover],
  ];
  for (const [key, label, ref, allowed] of filing) {
    if (!allowed) continue;
    // A filed day reads 1, a missing one 0: for this metric the gap is the figure.
    const v = series.get(ref) ?? blank();
    metrics.push({
      id: `completeness:${key}`,
      kind: 'completeness',
      label,
      group: 'Kelengkapan',
      digits: 0,
      higherIsWorse: false,
      current: v.c.map((x) => x ?? 0),
      previous: v.p.map((x) => x ?? 0),
    });
  }

  return {
    month,
    current,
    previous,
    site: { id: site.id, code: site.code, name: site.name },
    days,
    metrics,
  };
}
