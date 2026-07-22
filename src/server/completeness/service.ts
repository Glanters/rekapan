import type { AccessContext } from '../auth/access-context';
import { scopedDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ValidationError } from '../errors';

/**
 * Reporting completeness.
 *
 * For each site and date in a window, four independent tasks: a Monthly report,
 * a Turnover report, at least one Monthly image, and at least one Turnover
 * image. The page renders a tick per completed task, so an operator can see at a
 * glance which site is missing what on which day.
 *
 * SCALE. The window is capped and every query returns only `(siteId, date)`
 * pairs — never the rows themselves — so the result is bounded by
 * sites × days regardless of how many reports or images sit behind it. All four
 * reads go through the scoped client, so a caller only ever sees their sites.
 */

const MS_PER_DAY = 86_400_000;

/** Widest window the matrix will render; a wider request is clamped to it. */
export const COMPLETENESS_MAX_DAYS = 62;

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

export interface CompletenessCell {
  monthly: boolean;
  turnover: boolean;
  imageMonthly: boolean;
  imageTurnover: boolean;
}

export interface CompletenessSite {
  id: string;
  code: string;
  name: string;
}

export interface CompletenessResult {
  from: string;
  to: string;
  /** Every date in the window, ascending — the matrix columns. */
  dates: string[];
  /** Sites in scope, ordered by name — the matrix rows. */
  sites: CompletenessSite[];
  /** Keyed `${siteId}|${date}`. A missing key means nothing was done that day. */
  cells: Record<string, CompletenessCell>;
}

export interface CompletenessParams {
  from?: string | undefined;
  to?: string | undefined;
  siteId?: string | undefined;
}

function eachIsoDate(from: string, to: string): string[] {
  const end = fromIsoDate(to).getTime();
  const dates: string[] = [];
  for (let t = fromIsoDate(from).getTime(); t <= end; t += MS_PER_DAY) {
    dates.push(toIsoDate(new Date(t)));
  }
  return dates;
}

/** Resolves the window, defaulting to the current month and clamping the width. */
function resolveWindow(params: CompletenessParams): { from: string; to: string } {
  const to = params.to ?? toIsoDate(new Date());
  let from = params.from ?? `${to.slice(0, 7)}-01`;

  if (fromIsoDate(from).getTime() > fromIsoDate(to).getTime()) {
    throw new ValidationError('Tanggal mulai tidak boleh melewati tanggal akhir.');
  }

  const days =
    Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / MS_PER_DAY) +
    1;
  if (days > COMPLETENESS_MAX_DAYS) {
    from = toIsoDate(
      new Date(fromIsoDate(to).getTime() - (COMPLETENESS_MAX_DAYS - 1) * MS_PER_DAY),
    );
  }

  return { from, to };
}

export async function getCompleteness(
  ctx: AccessContext,
  params: CompletenessParams = {},
): Promise<CompletenessResult> {
  ctx.requirePermission('dashboard.view');

  const { from, to } = resolveWindow(params);
  const range = { gte: fromIsoDate(from), lte: fromIsoDate(to) };
  // A site filter narrows within the caller's scope; scopedWhere still AND-s the
  // site constraint on top, so this cannot widen past it.
  const bySite = params.siteId ? { siteId: params.siteId } : {};

  const db = scopedDb(ctx);
  const [sites, monthly, turnover, imageMonthly, imageTurnover] = await Promise.all([
    db.site.findMany({
      where: scopedWhere(ctx, 'Site', {
        deletedAt: null,
        status: 'ACTIVE',
        ...(params.siteId ? { id: params.siteId } : {}),
      }),
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.monthlyReport.findMany({
      where: scopedWhere(ctx, 'MonthlyReport', {
        deletedAt: null,
        reportDate: range,
        ...bySite,
      }),
      select: { siteId: true, reportDate: true },
    }),
    db.turnoverReport.findMany({
      where: scopedWhere(ctx, 'TurnoverReport', {
        deletedAt: null,
        reportDate: range,
        ...bySite,
      }),
      select: { siteId: true, reportDate: true },
    }),
    db.imageAsset.findMany({
      where: scopedWhere(ctx, 'ImageAsset', {
        deletedAt: null,
        category: 'MONTHLY',
        uploadDate: range,
        ...bySite,
      }),
      select: { siteId: true, uploadDate: true },
      distinct: ['siteId', 'uploadDate'],
    }),
    db.imageAsset.findMany({
      where: scopedWhere(ctx, 'ImageAsset', {
        deletedAt: null,
        category: 'TURNOVER',
        uploadDate: range,
        ...bySite,
      }),
      select: { siteId: true, uploadDate: true },
      distinct: ['siteId', 'uploadDate'],
    }),
  ]);

  const cells: Record<string, CompletenessCell> = {};
  const cell = (siteId: string, date: string): CompletenessCell =>
    (cells[`${siteId}|${date}`] ??= {
      monthly: false,
      turnover: false,
      imageMonthly: false,
      imageTurnover: false,
    });

  for (const row of monthly) cell(row.siteId, toIsoDate(row.reportDate)).monthly = true;
  for (const row of turnover)
    cell(row.siteId, toIsoDate(row.reportDate)).turnover = true;
  for (const row of imageMonthly) {
    cell(row.siteId, toIsoDate(row.uploadDate)).imageMonthly = true;
  }
  for (const row of imageTurnover) {
    cell(row.siteId, toIsoDate(row.uploadDate)).imageTurnover = true;
  }

  return { from, to, dates: eachIsoDate(from, to), sites, cells };
}
