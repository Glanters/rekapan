import type { Prisma } from '@/generated/prisma/client';
import type { ImportKind } from '@/generated/prisma/enums';

import type { AccessContext } from '../auth/access-context';
import { unsafeDb } from '../db/prisma';
import { logger } from '../logger';
import type { ImportRowResult, TransferFormat } from './types';

/**
 * Job bookkeeping for imports and exports.
 *
 * Written through `unsafeDb` for the same reason the audit log is: these rows
 * record what a user attempted, including attempts that touched no site at all,
 * so routing them through the site-scoping guard would drop the entries most
 * worth keeping. Neither model is site-owned, so no constraint is being evaded.
 */

const FORMAT_BY_KEY: Record<TransferFormat, 'XLSX' | 'CSV'> = {
  xlsx: 'XLSX',
  csv: 'CSV',
};

/**
 * Opens an ExportJob before a single byte is streamed.
 *
 * Recorded as PROCESSING and closed out by {@link finishExportJob} once the
 * stream settles, because the row count is only truthful after the last row has
 * actually been written — a job marked COMPLETED up front would claim success
 * for a download the client aborted halfway.
 */
export async function startExportJob(
  ctx: AccessContext,
  input: {
    module: string;
    format: TransferFormat;
    filters: Prisma.InputJsonValue;
  },
): Promise<string | null> {
  try {
    const job = await unsafeDb.exportJob.create({
      data: {
        module: input.module,
        format: FORMAT_BY_KEY[input.format],
        status: 'PROCESSING',
        userId: ctx.userId,
        filters: input.filters,
        startedAt: new Date(),
      },
      select: { id: true },
    });
    return job.id;
  } catch (cause) {
    // Bookkeeping must not cost the user their download.
    logger.error('Failed to open export job', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

export async function finishExportJob(
  jobId: string | null,
  error: Error | null,
  rowCount: number,
): Promise<void> {
  if (!jobId) return;

  try {
    await unsafeDb.exportJob.update({
      where: { id: jobId },
      data: {
        status: error ? 'FAILED' : 'COMPLETED',
        rowCount,
        finishedAt: new Date(),
      },
    });
  } catch (cause) {
    logger.error('Failed to close export job', {
      jobId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Records a completed import.
 *
 * Only failing rows are persisted in `errors`. The successful ones are already
 * in the reports themselves, and storing a full copy of every uploaded file in
 * a JSONB column would grow without bound for no diagnostic gain.
 */
export async function recordImportJob(
  ctx: AccessContext,
  input: {
    kind: ImportKind;
    originalName: string;
    fileSize: number;
    startedAt: Date;
    totalRows: number;
    successRows: number;
    failedRows: number;
    rows: readonly ImportRowResult[];
    failed?: boolean;
  },
): Promise<string | null> {
  const errors = input.rows
    .filter((row) => !row.valid)
    .map((row) => ({
      row: row.row,
      siteCode: row.siteCode,
      reportDate: row.reportDate,
      errors: row.errors,
    }));

  try {
    const job = await unsafeDb.importJob.create({
      data: {
        kind: input.kind,
        status: input.failed ? 'FAILED' : 'COMPLETED',
        userId: ctx.userId,
        originalName: input.originalName.slice(0, 255),
        fileSize: BigInt(input.fileSize),
        totalRows: input.totalRows,
        successRows: input.successRows,
        failedRows: input.failedRows,
        errors: errors.length > 0 ? errors : undefined,
        startedAt: input.startedAt,
        finishedAt: new Date(),
      },
      select: { id: true },
    });
    return job.id;
  } catch (cause) {
    logger.error('Failed to record import job', {
      kind: input.kind,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}
