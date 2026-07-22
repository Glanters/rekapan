import type { Prisma } from '@/generated/prisma/client';
import type {
  ColumnComputation,
  ColumnDataType,
  ReportStatus,
  ResultEffect,
} from '@/generated/prisma/enums';

import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { resolveUserNames } from '../users/service';

/**
 * Monthly reporting.
 *
 * Values live in an entity–attribute–value shape so administrators can add a
 * column without a migration. The cost lands here: rows must be pivoted before
 * they can be displayed as a table. That work is done once, server-side, over a
 * bounded page — never in the browser and never across the whole table.
 */

export interface MonthlyColumnDto {
  id: string;
  key: string;
  label: string;
  group: string | null;
  dataType: ColumnDataType;
  position: number;
  precision: number;
  unit: string | null;
  includeInTotals: boolean;
  isRequired: boolean;
  /** How this column feeds the derived Hasil. */
  resultEffect: ResultEffect;
  /** Whether the value is entered by hand or computed. */
  computation: ColumnComputation;
}

/** A bank members can register through; one column of the Validasi breakdown. */
export interface BankDto {
  id: string;
  code: string;
  name: string;
  position: number;
}

export type CellValue = number | string | boolean | null;

export interface MonthlyRowDto {
  id: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  /** ISO date, no time component. */
  reportDate: string;
  status: ReportStatus;
  note: string | null;
  values: Record<string, CellValue>;
  /** Member registrations keyed by bank code. Sums to the Validasi column. */
  validations: Record<string, number>;
  /** ISO 8601 with time. Surfaced for the row's info popover. */
  createdAt: string;
  updatedAt: string;
  /** Display name of who created / last edited the report; null if unknown. */
  createdBy: string | null;
  updatedBy: string | null;
}

export interface MonthlyListResult {
  columns: MonthlyColumnDto[];
  /** Active banks, in order — the columns of the Validasi breakdown. */
  banks: BankDto[];
  rows: MonthlyRowDto[];
  /** Column-key totals across the returned page, for the table footer. */
  totals: Record<string, number>;
  pagination: { page: number; perPage: number; total: number };
}

/** `@db.Date` values are UTC midnight; formatting by UTC parts avoids a local-timezone shift. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses `YYYY-MM-DD` into the UTC midnight Postgres stores for a `date`. */
function fromIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"${value}" is not a valid date.`);
  }
  return parsed;
}

const COLUMN_SELECT = {
  id: true,
  key: true,
  label: true,
  group: true,
  dataType: true,
  position: true,
  precision: true,
  unit: true,
  includeInTotals: true,
  isRequired: true,
  resultEffect: true,
  computation: true,
} as const;

/**
 * Every column, across all templates.
 *
 * Used where the full catalogue is needed — upsert validation (keys are globally
 * unique, so no template scoping is required to resolve a submitted key) and the
 * bulk exports. The table and entry form use {@link listTemplateColumns}.
 */
export async function listColumns(): Promise<MonthlyColumnDto[]> {
  return unsafeDb.monthlyColumn.findMany({
    where: { deletedAt: null },
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    select: COLUMN_SELECT,
  });
}

/**
 * The columns a template shows: the shared ones (null templateId) plus that
 * template's own. A null templateId yields the shared columns alone.
 */
export async function listTemplateColumns(
  templateId: string | null,
): Promise<MonthlyColumnDto[]> {
  return unsafeDb.monthlyColumn.findMany({
    where: {
      deletedAt: null,
      ...(templateId
        ? { OR: [{ templateId: null }, { templateId }] }
        : { templateId: null }),
    },
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    select: COLUMN_SELECT,
  });
}

export interface MonthlyTemplateDto {
  id: string;
  code: string;
  name: string;
}

/** Every template, in display order — for the site template picker. */
export async function listMonthlyTemplates(): Promise<MonthlyTemplateDto[]> {
  return unsafeDb.monthlyTemplate.findMany({
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true },
  });
}

/**
 * The template whose columns the table and form should show for a site filter.
 *
 * A single selected site uses its own template; anything else (all sites, or a
 * site with no template) falls back to the primary template, so the familiar
 * all-sites view keeps its columns rather than collapsing to the shared few.
 */
async function resolveDisplayTemplateId(
  siteIds: readonly string[] | null,
): Promise<string | null> {
  const [only] = siteIds ?? [];
  if (siteIds?.length === 1 && only) {
    const site = await unsafeDb.site.findUnique({
      where: { id: only },
      select: { templateId: true },
    });
    if (site?.templateId) return site.templateId;
  }

  const primary = await unsafeDb.monthlyTemplate.findFirst({
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  return primary?.id ?? null;
}

/**
 * Active banks, in display order.
 *
 * Deliberately excludes inactive ones: a bank that stopped being used should
 * disappear from the entry form without erasing the registrations already
 * recorded against it, which is why deactivating is offered instead of deleting.
 */
export async function listBanks(): Promise<BankDto[]> {
  return unsafeDb.bank.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, position: true },
  });
}

export interface ListMonthlyParams {
  siteIds?: readonly string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: ReportStatus | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}

/**
 * The filter behind both the table and the export.
 *
 * Shared so the two cannot drift: an export that honoured a different set of
 * filters than the list it was launched from would hand the operator a file
 * that disagrees with the screen they were looking at.
 */
function buildMonthlyWhere(
  ctx: AccessContext,
  params: ListMonthlyParams,
): Record<string, unknown> {
  const siteIds = ctx.narrowSiteFilter(params.siteIds);

  const dateFilter =
    params.from || params.to
      ? {
          reportDate: {
            ...(params.from ? { gte: fromIsoDate(params.from) } : {}),
            ...(params.to ? { lte: fromIsoDate(params.to) } : {}),
          },
        }
      : {};

  return scopedWhere(ctx, 'MonthlyReport', {
    deletedAt: null,
    ...(siteIds ? { siteId: { in: [...siteIds] } } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...dateFilter,
  });
}

/** The columns every read of a report selects. */
const REPORT_SELECT = {
  id: true,
  siteId: true,
  reportDate: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  site: { select: { code: true, name: true } },
  values: {
    select: {
      columnId: true,
      valueNumeric: true,
      valueText: true,
      valueDate: true,
      valueBool: true,
    },
  },
  validations: {
    select: { bankId: true, memberCount: true },
  },
} as const;

/**
 * Structural shape of a selected report.
 *
 * `valueNumeric` is `unknown` because Postgres `Decimal` has no native
 * JavaScript counterpart — the driver hands back a Decimal object, and naming
 * that type here would tie this module to the client's runtime representation.
 */
interface MonthlyReportRecord {
  id: string;
  siteId: string;
  reportDate: Date;
  status: ReportStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
  site: { code: string; name: string };
  validations: readonly { bankId: string; memberCount: number }[];
  values: readonly {
    columnId: string;
    valueNumeric: unknown;
    valueText: string | null;
    valueDate: Date | null;
    valueBool: boolean | null;
  }[];
}

/**
 * Turns one report's EAV rows into the flat record the table renders.
 *
 * @param totals Optional accumulator. Passed by the list endpoint, which shows a
 *   footer; omitted by the export, which has no page to total over.
 */
function pivotMonthlyReport(
  report: MonthlyReportRecord,
  columnById: ReadonlyMap<string, MonthlyColumnDto>,
  bankById: ReadonlyMap<string, BankDto>,
  nameById: ReadonlyMap<string, string>,
  totals?: Record<string, number>,
): MonthlyRowDto {
  const values: Record<string, CellValue> = {};

  const validations: Record<string, number> = {};
  let validationTotal = 0;
  for (const entry of report.validations) {
    const bank = bankById.get(entry.bankId);
    // A registration against a deactivated bank still counts toward the total —
    // the members did register. It simply has no column to show itself in.
    validationTotal += entry.memberCount;
    if (bank) validations[bank.code] = entry.memberCount;
  }

  for (const value of report.values) {
    const column = columnById.get(value.columnId);
    // A value whose column was deleted is skipped rather than surfaced under
    // an unknown key the table has no header for.
    if (!column) continue;

    let cell: CellValue = null;
    switch (column.dataType) {
      case 'TEXT':
        cell = value.valueText;
        break;
      case 'DATE':
        cell = value.valueDate ? toIsoDate(value.valueDate) : null;
        break;
      case 'BOOLEAN':
        cell = value.valueBool;
        break;
      default:
        // Decimal is exact in Postgres but has no JSON representation, so it
        // crosses the wire as a number. Totals are summed here, server-side,
        // rather than reconstructed from these rounded values in the client.
        cell = value.valueNumeric === null ? null : Number(value.valueNumeric);
        if (totals && column.includeInTotals && typeof cell === 'number') {
          totals[column.key] = (totals[column.key] ?? 0) + cell;
        }
        break;
    }

    values[column.key] = cell;
  }

  // Order matters: the validation total must land before the result is derived,
  // in case an administrator ever marks Validasi as contributing to Hasil.
  applyValidationTotal(values, columnById, validationTotal, totals);
  applyResultEffect(values, columnById, totals);

  return {
    id: report.id,
    siteId: report.siteId,
    siteCode: report.site.code,
    siteName: report.site.name,
    reportDate: toIsoDate(report.reportDate),
    status: report.status,
    note: report.note,
    values,
    validations,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    createdBy: report.createdById ? (nameById.get(report.createdById) ?? null) : null,
    updatedBy: report.updatedById ? (nameById.get(report.updatedById) ?? null) : null,
  };
}

/**
 * Writes the per-bank sum into whichever column is marked VALIDATION_TOTAL.
 *
 * Derived rather than stored, for the same reason the result is: the breakdown
 * is the truth, and a stored total would drift the moment one bank's figure was
 * corrected.
 */
function applyValidationTotal(
  values: Record<string, CellValue>,
  columnById: ReadonlyMap<string, MonthlyColumnDto>,
  validationTotal: number,
  totals?: Record<string, number>,
): void {
  for (const column of columnById.values()) {
    if (column.computation !== 'VALIDATION_TOTAL') continue;

    // Back out whatever the stored value contributed before substituting the
    // derived one, or the footer would total a figure the rows no longer show.
    if (totals) {
      const stored = values[column.key];
      if (typeof stored === 'number') {
        totals[column.key] = (totals[column.key] ?? 0) - stored;
      }
      if (column.includeInTotals) {
        totals[column.key] = (totals[column.key] ?? 0) + validationTotal;
      }
    }

    values[column.key] = validationTotal;
    return;
  }
}

/**
 * Derives the Hasil column from the contributions of the others.
 *
 * Computed on read rather than stored. A stored result drifts the moment any
 * contributing figure is corrected — and the correction and the recompute are
 * two writes, so there is always a window where the two disagree. Deriving it
 * makes disagreement impossible to represent.
 *
 * Any value already sitting in the result column is overwritten. That is
 * deliberate: once a column is marked RESULT, its stored figure is a leftover
 * from before the switch, and showing it would contradict the columns beside it.
 */
function applyResultEffect(
  values: Record<string, CellValue>,
  columnById: ReadonlyMap<string, MonthlyColumnDto>,
  totals?: Record<string, number>,
): void {
  let resultKey: string | null = null;
  let computed = 0;

  for (const column of columnById.values()) {
    if (column.resultEffect === 'RESULT') {
      resultKey = column.key;
      continue;
    }
    if (column.resultEffect === 'NEUTRAL') continue;

    const value = values[column.key];
    if (typeof value !== 'number') continue;

    computed += column.resultEffect === 'ADD' ? value : -value;
  }

  if (!resultKey) return;

  // The stored value may already have been folded into the running total by the
  // caller's loop; back it out before substituting the derived one, or the
  // footer would total a figure the rows no longer show.
  if (totals) {
    const stored = values[resultKey];
    if (typeof stored === 'number') {
      totals[resultKey] = (totals[resultKey] ?? 0) - stored;
    }
    totals[resultKey] = (totals[resultKey] ?? 0) + computed;
  }

  values[resultKey] = computed;
}

export async function listMonthly(
  ctx: AccessContext,
  params: ListMonthlyParams = {},
): Promise<MonthlyListResult> {
  ctx.requirePermission('monthly.view');

  const page = Math.max(1, params.page ?? 1);
  // Capped: the page size reaches the database, so an unbounded value from the
  // query string would be a trivial way to ask for millions of rows.
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));

  const where = buildMonthlyWhere(ctx, params);
  const db = scopedDb(ctx);

  // The table — and the entry form it feeds — shows the columns of one template:
  // the selected site's, or the primary template for the all-sites view.
  const templateId = await resolveDisplayTemplateId(
    ctx.narrowSiteFilter(params.siteIds),
  );

  const [columns, banks, total, reports] = await Promise.all([
    listTemplateColumns(templateId),
    listBanks(),
    db.monthlyReport.count({ where }),
    db.monthlyReport.findMany({
      where,
      // Ascending: this is a daily ledger, so days run downwards and the newest
      // row sits at the bottom, directly above the totals footer. It also makes
      // the screen agree with the Excel export, which was already ascending.
      orderBy: [{ reportDate: 'asc' }, { siteId: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: REPORT_SELECT,
    }),
  ]);

  const columnById = new Map(columns.map((column) => [column.id, column]));
  const bankById = new Map(banks.map((bank) => [bank.id, bank]));
  const nameById = await resolveUserNames(
    reports.flatMap((report) => [report.createdById, report.updatedById]),
  );
  const totals: Record<string, number> = {};
  const rows = reports.map((report) =>
    pivotMonthlyReport(report, columnById, bankById, nameById, totals),
  );

  return { columns, banks, rows, totals, pagination: { page, perPage, total } };
}

/** Rows matching an export's filters, before any of them are fetched. */
export async function countMonthly(
  ctx: AccessContext,
  params: ListMonthlyParams = {},
): Promise<number> {
  return scopedDb(ctx).monthlyReport.count({ where: buildMonthlyWhere(ctx, params) });
}

/**
 * Yields pivoted rows in batches, oldest first.
 *
 * A generator rather than an array: an export can legitimately span tens of
 * thousands of rows, and materialising them all to hand to the workbook writer
 * would defeat the point of streaming the response. Offset paging is safe here
 * because `(siteId, reportDate)` is unique, which makes the ordering total —
 * no row can shift between batches and be emitted twice or skipped.
 */
export async function* streamMonthlyRows(
  ctx: AccessContext,
  params: ListMonthlyParams = {},
  batchSize = 500,
): AsyncGenerator<MonthlyRowDto[]> {
  const where = buildMonthlyWhere(ctx, params);
  const [columns, banks] = await Promise.all([listColumns(), listBanks()]);
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const bankById = new Map(banks.map((bank) => [bank.id, bank]));
  // The export does not surface author names, so it skips the per-batch user
  // lookup and leaves createdBy/updatedBy null.
  const noNames: ReadonlyMap<string, string> = new Map();
  const db = scopedDb(ctx);

  for (let skip = 0; ; skip += batchSize) {
    const reports = await db.monthlyReport.findMany({
      where,
      orderBy: [{ reportDate: 'asc' }, { siteId: 'asc' }],
      skip,
      take: batchSize,
      select: REPORT_SELECT,
    });

    if (reports.length === 0) return;
    yield reports.map((report) =>
      pivotMonthlyReport(report, columnById, bankById, noNames),
    );
    if (reports.length < batchSize) return;
  }
}

export interface UpsertMonthlyInput {
  siteId: string;
  reportDate: string;
  note?: string | undefined;
  /** Keyed by MonthlyColumn.key; omitted keys are left untouched. */
  values: Record<string, CellValue>;
  /**
   * Member registrations keyed by bank code. Omitting the field leaves the
   * existing breakdown alone; including a bank with 0 clears it to zero.
   */
  validations?: Record<string, number> | undefined;
}

/** The four typed columns a cell resolves to; exactly one is ever populated. */
interface ValueColumns {
  valueNumeric: number | null;
  valueText: string | null;
  valueDate: Date | null;
  valueBool: boolean | null;
}

/** One report's writes, fully validated and ready to execute. */
export interface MonthlyWritePlan {
  siteId: string;
  reportDate: Date;
  note: string | null | undefined;
  values: readonly { columnId: string; data: ValueColumns }[];
  /** Per-bank member counts, or null when the caller did not supply any. */
  validations: readonly { bankId: string; memberCount: number }[] | null;
  /** The report to update, or null to create one. */
  existingId: string | null;
}

/**
 * Reference data a plan is checked against.
 *
 * Loaded once per batch rather than per row. A thousand-row import that looked
 * up its columns and its existing reports one row at a time would issue
 * thousands of queries before writing anything.
 */
export interface MonthlyPlanContext {
  columnByKey: ReadonlyMap<string, MonthlyColumnDto>;
  /** Bank code → bank, for resolving the Validasi breakdown. */
  bankByCode: ReadonlyMap<string, BankDto>;
  /** `siteId|YYYY-MM-DD` → the report already stored for that day. */
  existingByKey: ReadonlyMap<string, { id: string; status: ReportStatus }>;
}

export interface MonthlyTarget {
  siteId: string;
  /** ISO `YYYY-MM-DD`. */
  reportDate: string;
}

function planKey(siteId: string, isoDate: string): string {
  return `${siteId}|${isoDate}`;
}

/**
 * Loads the columns and the already-stored reports a batch of upserts will
 * touch.
 *
 * The lookup runs through the site-scoped client, so a report belonging to a
 * site the caller cannot reach is simply absent from the map — the plan then
 * treats that day as new, and the write is refused later by
 * {@link planMonthlyUpsert}'s own site check rather than silently overwriting
 * another site's row.
 */
export async function loadMonthlyPlanContext(
  ctx: AccessContext,
  targets: readonly MonthlyTarget[],
): Promise<MonthlyPlanContext> {
  const [columns, banks] = await Promise.all([listColumns(), listBanks()]);
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const bankByCode = new Map(banks.map((bank) => [bank.code, bank]));
  const existingByKey = new Map<string, { id: string; status: ReportStatus }>();

  if (targets.length === 0) return { columnByKey, bankByCode, existingByKey };

  const siteIds = [...new Set(targets.map((target) => target.siteId))];
  const dates = [...new Set(targets.map((target) => target.reportDate))].map(
    fromIsoDate,
  );

  // Queried as the cross product of the distinct sites and dates rather than as
  // one OR branch per target: a branch-per-row filter grows a query with the
  // size of the upload, and the surplus rows this can match are discarded by
  // the keyed lookup anyway.
  const existing = await scopedDb(ctx).monthlyReport.findMany({
    where: scopedWhere(ctx, 'MonthlyReport', {
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

  return { columnByKey, bankByCode, existingByKey };
}

/**
 * Validates one upsert without touching the database.
 *
 * Everything that can be rejected is rejected here, before any write runs, so a
 * bulk import can report every bad row in one pass and a preview can reach the
 * same verdicts as the commit would without persisting anything.
 *
 * @throws {SiteAccessDeniedError} The target site is outside the caller's reach.
 * @throws {ValidationError} Unknown column, or an unparseable date or number.
 * @throws {ConflictError} The target report is locked.
 */
export function planMonthlyUpsert(
  ctx: AccessContext,
  input: UpsertMonthlyInput,
  context: MonthlyPlanContext,
): MonthlyWritePlan {
  // Site membership is checked before anything is written, so an out-of-scope
  // target fails as 404 rather than being partially applied.
  ctx.requireSite(input.siteId);

  const reportDate = fromIsoDate(input.reportDate);

  const unknown = Object.keys(input.values).filter(
    (key) => !context.columnByKey.has(key),
  );
  if (unknown.length > 0) {
    throw new ValidationError('The submitted data refers to unknown columns.', {
      unknownColumns: unknown,
    });
  }

  const existing = context.existingByKey.get(planKey(input.siteId, input.reportDate));
  if (existing?.status === 'LOCKED') {
    throw new ConflictError(
      'That report is locked and can no longer be edited. Ask a manager to unlock it first.',
    );
  }

  const values = Object.entries(input.values).flatMap(([key, raw]) => {
    const column = context.columnByKey.get(key);
    if (!column) return [];

    // Derived columns are computed on read, so a submitted value for one is
    // dropped rather than stored. Storing it would leave a figure in the
    // database that every read overwrites — dead data that disagrees with the
    // screen and misleads anyone querying the table directly.
    //
    // Dropped, not rejected: the edit form and the Excel template both
    // round-trip every column, and refusing the whole report because one
    // derived field came back would break a normal export-edit-reimport cycle
    // for no reason the operator could act on.
    if (column.resultEffect === 'RESULT') return [];
    if (column.computation !== 'NONE') return [];

    return [{ columnId: column.id, data: toValueColumns(column.dataType, raw) }];
  });

  // The breakdown is resolved here, alongside everything else that can be
  // rejected, so a bulk import reports an unknown bank in the same pass as an
  // unknown column rather than failing partway through the commit.
  let validations: { bankId: string; memberCount: number }[] | null = null;
  if (input.validations) {
    const unknownBanks = Object.keys(input.validations).filter(
      (code) => !context.bankByCode.has(code),
    );
    if (unknownBanks.length > 0) {
      throw new ValidationError('The submitted data refers to unknown banks.', {
        unknownBanks,
      });
    }

    validations = Object.entries(input.validations).flatMap(([code, count]) => {
      const bank = context.bankByCode.get(code);
      if (!bank) return [];

      const memberCount = Number(count);
      if (!Number.isFinite(memberCount) || memberCount < 0) {
        throw new ValidationError(
          `Jumlah member untuk bank "${code}" harus berupa angka nol atau lebih.`,
        );
      }
      // A head count, so fractional input is a mistake rather than precision.
      return [{ bankId: bank.id, memberCount: Math.round(memberCount) }];
    });
  }

  return {
    siteId: input.siteId,
    reportDate,
    note: input.note,
    values,
    validations,
    existingId: existing?.id ?? null,
  };
}

/**
 * Executes a validated plan on the given transaction client.
 *
 * Parameterised over the client so a bulk import can run many of these inside
 * one `$transaction` — a partial import is worse than a refused one, because
 * nothing on screen distinguishes it from a complete one.
 *
 * IDEMPOTENT BY CONSTRUCTION. `(siteId, reportDate)` is unique and every value
 * write is an upsert keyed on `(reportId, columnId)`, so re-uploading the same
 * file corrects the rows it names instead of duplicating them.
 */
export async function commitMonthlyUpsert(
  tx: Prisma.TransactionClient,
  ctx: AccessContext,
  plan: MonthlyWritePlan,
): Promise<{ id: string; created: boolean }> {
  const report = plan.existingId
    ? await tx.monthlyReport.update({
        where: { id: plan.existingId },
        data: {
          ...(plan.note !== undefined ? { note: plan.note } : {}),
          deletedAt: null,
          updatedById: ctx.userId,
        },
        select: { id: true },
      })
    : await tx.monthlyReport.create({
        data: {
          siteId: plan.siteId,
          reportDate: plan.reportDate,
          note: plan.note ?? null,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
        select: { id: true },
      });

  for (const value of plan.values) {
    await tx.monthlyValue.upsert({
      where: { reportId_columnId: { reportId: report.id, columnId: value.columnId } },
      create: { reportId: report.id, columnId: value.columnId, ...value.data },
      update: value.data,
    });
  }

  // `null` means the caller said nothing about the breakdown, so it is left as
  // it was. An empty array means they explicitly submitted none, which clears
  // it — the distinction matters for the Excel importer, whose sheets carry no
  // bank columns and must not wipe a breakdown entered through the UI.
  if (plan.validations !== null) {
    for (const entry of plan.validations) {
      await tx.monthlyValidation.upsert({
        where: {
          reportId_bankId: { reportId: report.id, bankId: entry.bankId },
        },
        create: {
          reportId: report.id,
          bankId: entry.bankId,
          memberCount: entry.memberCount,
        },
        update: { memberCount: entry.memberCount },
      });
    }

    // Banks the caller omitted are dropped rather than left behind: the
    // submitted set is the whole breakdown, so a bank removed from the form
    // must disappear from the total too.
    await tx.monthlyValidation.deleteMany({
      where: {
        reportId: report.id,
        bankId: { notIn: plan.validations.map((entry) => entry.bankId) },
      },
    });
  }

  return { id: report.id, created: plan.existingId === null };
}

/**
 * Creates or updates one day's report for one site.
 *
 * Idempotent on `(siteId, reportDate)`, which is also what makes Excel imports
 * safe to re-run — the unique constraint means a repeated upload corrects the
 * existing row instead of duplicating it.
 */
export async function upsertMonthly(ctx: AccessContext, input: UpsertMonthlyInput) {
  ctx.requireAnyPermission('monthly.create', 'monthly.update');

  const context = await loadMonthlyPlanContext(ctx, [
    { siteId: input.siteId, reportDate: input.reportDate },
  ]);
  const plan = planMonthlyUpsert(ctx, input, context);

  const result = await unsafeDb.$transaction((tx) =>
    commitMonthlyUpsert(tx, ctx, plan),
  );

  await recordAudit({
    action: result.created ? 'monthly.created' : 'monthly.updated',
    module: 'Monthly',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: input.siteId,
    entityType: 'MonthlyReport',
    entityId: result.id,
    after: {
      reportDate: input.reportDate,
      values: input.values,
      ...(input.validations ? { validations: input.validations } : {}),
    },
  });

  return { id: result.id };
}

/** Routes a submitted cell into the typed column its definition calls for. */
function toValueColumns(dataType: ColumnDataType, raw: CellValue): ValueColumns {
  const empty: ValueColumns = {
    valueNumeric: null,
    valueText: null,
    valueDate: null,
    valueBool: null,
  };

  if (raw === null || raw === '') return empty;

  switch (dataType) {
    case 'TEXT':
      return { ...empty, valueText: String(raw) };

    case 'DATE':
      return { ...empty, valueDate: fromIsoDate(String(raw)) };

    case 'BOOLEAN':
      return { ...empty, valueBool: Boolean(raw) };

    default: {
      const numeric =
        typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (Number.isNaN(numeric)) {
        throw new ValidationError(`"${String(raw)}" is not a valid number.`);
      }
      return { ...empty, valueNumeric: numeric };
    }
  }
}

export async function deleteMonthly(ctx: AccessContext, reportId: string) {
  ctx.requirePermission('monthly.delete');

  const report = await scopedDb(ctx).monthlyReport.findFirst({
    where: scopedWhere(ctx, 'MonthlyReport', { id: reportId, deletedAt: null }),
    select: { id: true, siteId: true, reportDate: true, status: true },
  });

  if (!report) throw new NotFoundError('Report not found.');
  if (report.status === 'LOCKED') {
    throw new ConflictError('That report is locked and cannot be deleted.');
  }

  // Soft delete: financial records are corrected, not erased.
  await unsafeDb.monthlyReport.update({
    where: { id: reportId },
    data: { deletedAt: new Date(), updatedById: ctx.userId },
  });

  await recordAudit({
    action: 'monthly.deleted',
    module: 'Monthly',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: report.siteId,
    entityType: 'MonthlyReport',
    entityId: reportId,
    before: { reportDate: toIsoDate(report.reportDate) },
  });

  return { id: reportId };
}
