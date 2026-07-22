import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { unsafeDb } from '../db/prisma';
import { isAppError, ValidationError } from '../errors';
import { finishExportJob, recordImportJob, startExportJob } from '../transfer/jobs';
import {
  EXPORT_BATCH_SIZE,
  EXPORT_ROW_LIMIT,
  IMPORT_TRANSACTION_MAX_WAIT_MS,
  IMPORT_TRANSACTION_TIMEOUT_MS,
} from '../transfer/limits';
import {
  DATE_HEADERS,
  DERIVED_HEADERS,
  NOTE_HEADERS,
  SITE_HEADERS,
  type SheetCell,
  type SheetMatrix,
  normaliseHeader,
  parseBooleanCell,
  parseDateCell,
  parseNumberCell,
  parseTextCell,
} from '../transfer/parse';
import { resolveSiteCodes } from '../transfer/sites';
import {
  CONTENT_TYPES,
  createTransferStream,
  transferFilename,
} from '../transfer/stream';
import type {
  ImportResult,
  ImportRowResult,
  TransferCell,
  TransferDownload,
  TransferFormat,
} from '../transfer/types';
import {
  type CellValue,
  type ListMonthlyParams,
  type MonthlyColumnDto,
  type MonthlyWritePlan,
  type UpsertMonthlyInput,
  commitMonthlyUpsert,
  countMonthly,
  listColumns,
  loadMonthlyPlanContext,
  planMonthlyUpsert,
  streamMonthlyRows,
} from './service';

/** Stable empty iterable for the template, which has headers but no rows. */
const NO_ROWS: readonly (readonly TransferCell[])[] = [];

/**
 * Excel transfer for the Monthly module.
 *
 * The header row is derived from `monthly_columns` on every request, never
 * hard-coded — the same reason the table is. An administrator who adds a column
 * gets it in the export, the template, and the importer at once, with no
 * deployment.
 */

/** Fixed leading columns, before the ones the database defines. */
const SITE_HEADER = 'site_code';
const DATE_HEADER = 'report_date';
const NOTE_HEADER = 'note';

function exportHeaders(columns: readonly MonthlyColumnDto[]): string[] {
  return [
    SITE_HEADER,
    'site_name',
    DATE_HEADER,
    NOTE_HEADER,
    // Labels, not keys: this is what the operator reads on screen, and the
    // importer accepts either spelling so a round trip still works.
    ...columns.map((column) => column.label),
  ];
}

// ============================================================================
// EXPORT
// ============================================================================

export interface MonthlyExportParams extends ListMonthlyParams {
  format: TransferFormat;
}

/**
 * Streams the rows matching the same filters the list endpoint honours.
 *
 * Refuses rather than truncates past {@link EXPORT_ROW_LIMIT}. A short export
 * is indistinguishable from a complete one once it is open in Excel, and every
 * total computed from it would be quietly wrong.
 *
 * @throws {ValidationError} The filters select more rows than the cap allows.
 */
export async function exportMonthly(
  ctx: AccessContext,
  params: MonthlyExportParams,
): Promise<TransferDownload> {
  ctx.requirePermission('monthly.export');

  const { format, ...filters } = params;

  const [columns, rowCount] = await Promise.all([
    listColumns(),
    countMonthly(ctx, filters),
  ]);

  if (rowCount > EXPORT_ROW_LIMIT) {
    throw new ValidationError(
      `Rentang ini berisi ${rowCount.toLocaleString('id-ID')} baris, melebihi batas ` +
        `${EXPORT_ROW_LIMIT.toLocaleString('id-ID')} baris per ekspor. ` +
        'Persempit rentang tanggal atau pilih satu site, lalu coba lagi.',
      { rowCount, limit: EXPORT_ROW_LIMIT },
    );
  }

  const jobId = await startExportJob(ctx, {
    module: 'Monthly',
    format,
    filters: {
      siteIds: filters.siteIds ? [...filters.siteIds] : [],
      from: filters.from ?? '',
      to: filters.to ?? '',
      rowCount,
    },
  });

  await recordAudit({
    action: 'monthly.exported',
    module: 'Monthly',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'ExportJob',
    entityId: jobId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    after: { format, rowCount, from: filters.from, to: filters.to },
  });

  const body = createTransferStream(format, {
    sheetName: 'Monthly',
    headers: exportHeaders(columns),
    rows: async function* () {
      for await (const batch of streamMonthlyRows(ctx, filters, EXPORT_BATCH_SIZE)) {
        for (const row of batch) {
          // Numbers are emitted as numbers, not strings, so Excel can sum the
          // column instead of showing it left-aligned and inert.
          yield [
            row.siteCode,
            row.siteName,
            row.reportDate,
            row.note,
            ...columns.map((column) => row.values[column.key] ?? null),
          ];
        }
      }
    },
    onSettled: (error, rowsWritten) => finishExportJob(jobId, error, rowsWritten),
  });

  return {
    body,
    filename: transferFilename('monthly', format, [filters.from, filters.to]),
    contentType: CONTENT_TYPES[format],
  };
}

// ============================================================================
// TEMPLATE
// ============================================================================

/**
 * An empty workbook carrying exactly the headers the importer expects.
 *
 * This is what makes the import usable: without it an operator has to guess the
 * spelling of every column, and a guess that is close but wrong is rejected as
 * an unknown header.
 */
export async function monthlyTemplate(
  ctx: AccessContext,
  format: TransferFormat,
): Promise<TransferDownload> {
  ctx.requirePermission('monthly.import');

  const columns = await listColumns();

  const body = createTransferStream(format, {
    sheetName: 'Monthly',
    // The derived columns are left out: the template is for entry, and a column
    // the importer ignores only invites someone to fill it in.
    headers: [SITE_HEADER, DATE_HEADER, NOTE_HEADER, ...columns.map((c) => c.label)],
    rows: async function* () {
      yield* NO_ROWS;
    },
  });

  return {
    body,
    filename: transferFilename('monthly_template', format),
    contentType: CONTENT_TYPES[format],
  };
}

// ============================================================================
// IMPORT
// ============================================================================

/** Where each recognised header sits in the uploaded sheet. */
interface HeaderLayout {
  siteIndex: number;
  dateIndex: number;
  noteIndex: number | null;
  columnsByIndex: ReadonlyMap<number, MonthlyColumnDto>;
  recognised: string[];
}

/**
 * Matches the uploaded header row against the column catalogue.
 *
 * An unrecognised header is fatal rather than ignored. Skipping it would drop a
 * whole column of figures while reporting the import as a success, which is the
 * one failure mode an operator has no way to notice.
 *
 * @throws {ValidationError} Missing required headers, or headers matching nothing.
 */
function resolveHeaders(
  headers: readonly string[],
  columns: readonly MonthlyColumnDto[],
): HeaderLayout {
  const byLabel = new Map(
    columns.map((column) => [normaliseHeader(column.label), column]),
  );
  const byKey = new Map(columns.map((column) => [normaliseHeader(column.key), column]));

  let siteIndex = -1;
  let dateIndex = -1;
  let noteIndex: number | null = null;
  const columnsByIndex = new Map<number, MonthlyColumnDto>();
  const recognised: string[] = [];
  const unknown: string[] = [];
  const duplicated: string[] = [];

  headers.forEach((raw, index) => {
    const header = normaliseHeader(raw);
    if (header === '') return;

    if (SITE_HEADERS.has(header)) {
      siteIndex = index;
      return;
    }
    if (DATE_HEADERS.has(header)) {
      dateIndex = index;
      return;
    }
    if (NOTE_HEADERS.has(header)) {
      noteIndex = index;
      return;
    }
    if (DERIVED_HEADERS.has(header)) return;

    // Key first: keys are unique by schema, labels are not.
    const column = byKey.get(header) ?? byLabel.get(header);
    if (!column) {
      unknown.push(raw);
      return;
    }
    if ([...columnsByIndex.values()].some((existing) => existing.id === column.id)) {
      duplicated.push(raw);
      return;
    }

    columnsByIndex.set(index, column);
    recognised.push(column.label);
  });

  const missing: string[] = [];
  if (siteIndex < 0) missing.push(SITE_HEADER);
  if (dateIndex < 0) missing.push(DATE_HEADER);

  if (missing.length > 0) {
    throw new ValidationError(
      `Kolom wajib tidak ditemukan: ${missing.join(', ')}. Unduh templat untuk judul yang benar.`,
      { missing },
    );
  }

  if (unknown.length > 0) {
    throw new ValidationError(
      `Judul kolom tidak dikenali: ${unknown.join(', ')}. ` +
        'Perbaiki judulnya atau hapus kolom tersebut, lalu unggah ulang.',
      { unknown },
    );
  }

  if (duplicated.length > 0) {
    throw new ValidationError(
      `Kolom muncul lebih dari sekali: ${duplicated.join(', ')}.`,
      { duplicated },
    );
  }

  return { siteIndex, dateIndex, noteIndex, columnsByIndex, recognised };
}

/** Reads one cell according to the data type its column declares. */
function readCell(cell: SheetCell, column: MonthlyColumnDto): CellValue {
  switch (column.dataType) {
    case 'TEXT':
      return parseTextCell(cell);
    case 'DATE':
      return parseDateCell(cell);
    case 'BOOLEAN':
      return parseBooleanCell(cell);
    default:
      return parseNumberCell(cell);
  }
}

/** A row that passed validation, paired with the sheet row it came from. */
interface CandidateRow {
  rowNumber: number;
  input: UpsertMonthlyInput;
}

export interface ImportMonthlyInput {
  matrix: SheetMatrix;
  originalName: string;
  fileSize: number;
  /** When true nothing at all is written — not even an ImportJob. */
  dryRun: boolean;
}

/**
 * Validates an uploaded sheet and, unless this is a preview, applies it.
 *
 * Two phases, sharing one validation pass, so the preview an operator confirms
 * is the same verdict the commit acts on rather than a second opinion.
 *
 * The commit runs inside a single `$transaction`: a half-applied import looks
 * exactly like a complete one on screen, so the choice is all or nothing.
 *
 * IDEMPOTENT. `(siteId, reportDate)` is unique and the services upsert, so
 * re-uploading a corrected file fixes the rows it names instead of duplicating
 * them — which is what lets an operator fix the errors this reports and simply
 * upload the whole file again.
 */
export async function importMonthly(
  ctx: AccessContext,
  input: ImportMonthlyInput,
): Promise<ImportResult> {
  ctx.requirePermission('monthly.import');

  const startedAt = new Date();
  const columns = await listColumns();
  const layout = resolveHeaders(input.matrix.headers, columns);

  // Site codes are resolved in one query for the whole file rather than per
  // row, and through the scoped client — so a code the caller cannot reach
  // simply does not resolve.
  const siteCodes = input.matrix.rows.map((row) =>
    String(row.cells[layout.siteIndex] ?? '').trim(),
  );
  const siteByCode = await resolveSiteCodes(ctx, siteCodes);

  const results: ImportRowResult[] = [];
  const resultByRow = new Map<number, ImportRowResult>();
  const candidates: CandidateRow[] = [];
  /** `siteId|date` already claimed earlier in this same file. */
  const seen = new Map<string, number>();

  for (const row of input.matrix.rows) {
    const errors: string[] = [];
    const rawCode = String(row.cells[layout.siteIndex] ?? '').trim();
    const site = siteByCode.get(normaliseHeader(rawCode));

    if (rawCode === '') {
      errors.push('kolom site kosong');
    } else if (!site) {
      errors.push(`site "${rawCode}" tidak ditemukan atau di luar akses Anda`);
    }

    let reportDate: string | null = null;
    try {
      reportDate = parseDateCell(row.cells[layout.dateIndex] ?? null);
    } catch (cause) {
      errors.push(isAppError(cause) ? cause.message : 'tanggal tidak valid');
    }

    const values: Record<string, CellValue> = {};
    for (const [index, column] of layout.columnsByIndex) {
      try {
        const value = readCell(row.cells[index] ?? null, column);
        if (value === null && column.isRequired) {
          errors.push(`${column.label} wajib diisi`);
          continue;
        }
        values[column.key] = value;
      } catch (cause) {
        errors.push(
          `${column.label}: ${isAppError(cause) ? cause.message : 'nilai tidak valid'}`,
        );
      }
    }

    const note =
      layout.noteIndex === null
        ? undefined
        : (parseTextCell(row.cells[layout.noteIndex] ?? null) ?? undefined);

    if (site && reportDate && errors.length === 0) {
      const key = `${site.id}|${reportDate}`;
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        // Left to the operator rather than silently resolved: two rows for one
        // site-day means one of them is a mistake, and picking the later one
        // would discard data without saying so.
        errors.push(`duplikat dari baris ${earlier} untuk site dan tanggal yang sama`);
      } else {
        seen.set(key, row.number);
      }
    }

    if (errors.length === 0 && site && reportDate) {
      const candidate: UpsertMonthlyInput = {
        siteId: site.id,
        reportDate,
        values,
        ...(note !== undefined ? { note } : {}),
      };
      candidates.push({ rowNumber: row.number, input: candidate });
    }

    const result: ImportRowResult = {
      row: row.number,
      valid: errors.length === 0,
      siteCode: rawCode || null,
      reportDate,
      errors,
    };
    results.push(result);
    resultByRow.set(row.number, result);
  }

  // A second, cheaper pass: locked reports and any residual service-level
  // objection are caught here, before the transaction opens.
  const context = await loadMonthlyPlanContext(
    ctx,
    candidates.map((candidate) => ({
      siteId: candidate.input.siteId,
      reportDate: candidate.input.reportDate,
    })),
  );

  const plans: MonthlyWritePlan[] = [];
  for (const candidate of candidates) {
    try {
      plans.push(planMonthlyUpsert(ctx, candidate.input, context));
    } catch (cause) {
      const result = resultByRow.get(candidate.rowNumber);
      if (result) {
        result.valid = false;
        result.errors.push(isAppError(cause) ? cause.message : 'baris ditolak');
      }
    }
  }

  const successRows = plans.length;
  const failedRows = results.length - successRows;

  if (input.dryRun) {
    return {
      dryRun: true,
      totalRows: results.length,
      successRows,
      failedRows,
      rows: results,
      recognisedColumns: layout.recognised,
      importJobId: null,
    };
  }

  const touchedSites = [...new Set(plans.map((plan) => plan.siteId))];

  // Belt and braces over the scoped resolution above: one explicit bulk check
  // that every site about to be written is inside the caller's reach.
  ctx.requireSites(touchedSites);

  if (plans.length > 0) {
    await unsafeDb.$transaction(
      async (tx) => {
        for (const plan of plans) {
          await commitMonthlyUpsert(tx, ctx, plan);
        }
      },
      {
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS,
        timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
      },
    );
  }

  const importJobId = await recordImportJob(ctx, {
    kind: 'MONTHLY',
    originalName: input.originalName,
    fileSize: input.fileSize,
    startedAt,
    totalRows: results.length,
    successRows,
    failedRows,
    rows: results,
  });

  await recordAudit({
    action: 'monthly.imported',
    module: 'Monthly',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'ImportJob',
    entityId: importJobId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    after: {
      originalName: input.originalName,
      totalRows: results.length,
      successRows,
      failedRows,
      siteIds: touchedSites,
    },
  });

  return {
    dryRun: false,
    totalRows: results.length,
    successRows,
    failedRows,
    rows: results,
    recognisedColumns: layout.recognised,
    importJobId,
  };
}
