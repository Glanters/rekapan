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
  type SheetMatrix,
  normaliseHeader,
  parseDateCell,
  parseNumberCell,
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
  type ListTurnoverParams,
  type TurnoverGameDto,
  type TurnoverWritePlan,
  type UpsertTurnoverInput,
  commitTurnoverUpsert,
  countTurnover,
  listGames,
  loadTurnoverPlanContext,
  planTurnoverUpsert,
  streamTurnoverRows,
} from './service';

/**
 * Excel transfer for the Turnover module.
 *
 * Games are the columns. The header row is read from `turnover_games` on every
 * request, so adding a game adds a column to the export, the template, and the
 * importer at once — the same property the table relies on.
 */

const SITE_HEADER = 'site_code';
const DATE_HEADER = 'report_date';

// ============================================================================
// EXPORT
// ============================================================================

export interface TurnoverExportParams extends ListTurnoverParams {
  format: TransferFormat;
}

/**
 * Streams the rows matching the same filters the list endpoint honours.
 *
 * Refuses rather than truncates past {@link EXPORT_ROW_LIMIT}: a short export
 * looks complete once it is open, and every total taken from it would be wrong.
 *
 * @throws {ValidationError} The filters select more rows than the cap allows.
 */
export async function exportTurnover(
  ctx: AccessContext,
  params: TurnoverExportParams,
): Promise<TransferDownload> {
  ctx.requirePermission('turnover.export');

  const { format, ...filters } = params;

  const [games, rowCount] = await Promise.all([
    listGames(),
    countTurnover(ctx, filters),
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
    module: 'Turnover',
    format,
    filters: {
      siteIds: filters.siteIds ? [...filters.siteIds] : [],
      from: filters.from ?? '',
      to: filters.to ?? '',
      rowCount,
    },
  });

  await recordAudit({
    action: 'turnover.exported',
    module: 'Turnover',
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
    sheetName: 'Turnover',
    // `total` mirrors the column the table shows. The importer knows to ignore
    // it, so a file exported here can be edited and uploaded straight back.
    headers: [
      SITE_HEADER,
      'site_name',
      DATE_HEADER,
      ...games.map((game) => game.code),
      'total',
    ],
    rows: async function* () {
      for await (const batch of streamTurnoverRows(ctx, filters, EXPORT_BATCH_SIZE)) {
        for (const row of batch) {
          yield [
            row.siteCode,
            row.siteName,
            row.reportDate,
            ...games.map((game) => row.values[game.code] ?? null),
            row.rowTotal,
          ];
        }
      }
    },
    onSettled: (error, rowsWritten) => finishExportJob(jobId, error, rowsWritten),
  });

  return {
    body,
    filename: transferFilename('turnover', format, [filters.from, filters.to]),
    contentType: CONTENT_TYPES[format],
  };
}

// ============================================================================
// TEMPLATE
// ============================================================================

/** Stable empty iterable for the template, which has headers but no rows. */
const NO_ROWS: readonly (readonly TransferCell[])[] = [];

/**
 * An empty workbook carrying exactly the headers the importer expects — without
 * it, an operator has to guess every game code, and a near-miss is rejected.
 */
export async function turnoverTemplate(
  ctx: AccessContext,
  format: TransferFormat,
): Promise<TransferDownload> {
  ctx.requirePermission('turnover.import');

  const games = await listGames();

  const body = createTransferStream(format, {
    sheetName: 'Turnover',
    headers: [SITE_HEADER, DATE_HEADER, ...games.map((game) => game.code)],
    rows: async function* () {
      yield* NO_ROWS;
    },
  });

  return {
    body,
    filename: transferFilename('turnover_template', format),
    contentType: CONTENT_TYPES[format],
  };
}

// ============================================================================
// IMPORT
// ============================================================================

interface HeaderLayout {
  siteIndex: number;
  dateIndex: number;
  gamesByIndex: ReadonlyMap<number, TurnoverGameDto>;
  recognised: string[];
}

/**
 * Matches the uploaded header row against the game catalogue.
 *
 * An unrecognised header is fatal rather than ignored: skipping it would drop a
 * whole game's figures while reporting the import as a success, which is the
 * one failure an operator cannot see.
 *
 * @throws {ValidationError} Missing required headers, or headers matching nothing.
 */
function resolveHeaders(
  headers: readonly string[],
  games: readonly TurnoverGameDto[],
): HeaderLayout {
  const byCode = new Map(games.map((game) => [normaliseHeader(game.code), game]));
  const byName = new Map(games.map((game) => [normaliseHeader(game.name), game]));

  let siteIndex = -1;
  let dateIndex = -1;
  const gamesByIndex = new Map<number, TurnoverGameDto>();
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
    // Turnover has no note field, but an operator working from a Monthly
    // template may leave the column in place; ignoring it is kinder than
    // failing the whole upload over an empty column.
    if (NOTE_HEADERS.has(header) || DERIVED_HEADERS.has(header)) return;

    // Code first: codes are unique by schema, names are not.
    const game = byCode.get(header) ?? byName.get(header);
    if (!game) {
      unknown.push(raw);
      return;
    }
    if ([...gamesByIndex.values()].some((existing) => existing.id === game.id)) {
      duplicated.push(raw);
      return;
    }

    gamesByIndex.set(index, game);
    recognised.push(game.code);
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
      {
        duplicated,
      },
    );
  }

  return { siteIndex, dateIndex, gamesByIndex, recognised };
}

interface CandidateRow {
  rowNumber: number;
  input: UpsertTurnoverInput;
}

export interface ImportTurnoverInput {
  matrix: SheetMatrix;
  originalName: string;
  fileSize: number;
  /** When true nothing at all is written — not even an ImportJob. */
  dryRun: boolean;
}

/**
 * Validates an uploaded sheet and, unless this is a preview, applies it.
 *
 * Both phases share one validation pass, so the preview an operator confirms is
 * the same verdict the commit acts on. The commit runs inside a single
 * `$transaction`, because a half-applied import is indistinguishable on screen
 * from a complete one.
 *
 * IDEMPOTENT. `(siteId, reportDate)` is unique and the service upserts, so
 * re-uploading a corrected file fixes the rows it names instead of duplicating
 * them — which is what makes "fix the errors and upload the whole file again"
 * the right advice.
 */
export async function importTurnover(
  ctx: AccessContext,
  input: ImportTurnoverInput,
): Promise<ImportResult> {
  ctx.requirePermission('turnover.import');

  const startedAt = new Date();
  const games = await listGames();
  const layout = resolveHeaders(input.matrix.headers, games);

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

    const values: Record<string, number | null> = {};
    for (const [index, game] of layout.gamesByIndex) {
      try {
        values[game.code] = parseNumberCell(row.cells[index] ?? null);
      } catch (cause) {
        errors.push(
          `${game.code}: ${isAppError(cause) ? cause.message : 'nilai tidak valid'}`,
        );
      }
    }

    if (site && reportDate && errors.length === 0) {
      const key = `${site.id}|${reportDate}`;
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        // Reported rather than silently resolved: two rows for one site-day
        // means one is a mistake, and keeping the later one discards data
        // without saying so.
        errors.push(`duplikat dari baris ${earlier} untuk site dan tanggal yang sama`);
      } else {
        seen.set(key, row.number);
      }
    }

    if (errors.length === 0 && site && reportDate) {
      candidates.push({
        rowNumber: row.number,
        input: { siteId: site.id, reportDate, values },
      });
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

  // Second pass: locked reports and any residual service-level objection are
  // caught here, before the transaction opens.
  const context = await loadTurnoverPlanContext(
    ctx,
    candidates.map((candidate) => ({
      siteId: candidate.input.siteId,
      reportDate: candidate.input.reportDate,
    })),
  );

  const plans: TurnoverWritePlan[] = [];
  for (const candidate of candidates) {
    try {
      plans.push(planTurnoverUpsert(ctx, candidate.input, context));
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
          await commitTurnoverUpsert(tx, ctx, plan);
        }
      },
      {
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS,
        timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
      },
    );
  }

  const importJobId = await recordImportJob(ctx, {
    kind: 'TURNOVER',
    originalName: input.originalName,
    fileSize: input.fileSize,
    startedAt,
    totalRows: results.length,
    successRows,
    failedRows,
    rows: results,
  });

  await recordAudit({
    action: 'turnover.imported',
    module: 'Turnover',
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
