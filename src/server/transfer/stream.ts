import { PassThrough, type Readable } from 'node:stream';

import { stream as excelStream } from 'exceljs';

import { logger } from '../logger';
import type { TransferCell, TransferFormat, TransferSource } from './types';

/**
 * Streaming workbook generation.
 *
 * The workbook is never held whole. ExcelJS writes into a Node stream, that
 * stream is adapted to the web `ReadableStream` the route returns, and rows are
 * pulled from the database in batches as the client drains bytes. An export of
 * twenty thousand rows therefore costs a bounded amount of memory rather than a
 * buffer proportional to the result set.
 */

/**
 * Adapts a Node readable to the web stream a `Response` body wants.
 *
 * Backpressure is honoured deliberately: without the pause/resume pair the
 * source would push every chunk into the controller's queue as fast as ExcelJS
 * could produce it, which buffers the whole workbook in memory by another
 * route and defeats the point of streaming at all.
 */
export function nodeToWebStream(source: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) source.pause();
      });
      source.on('end', () => controller.close());
      source.on('error', (error: Error) => controller.error(error));
    },
    pull() {
      source.resume();
    },
    cancel() {
      // The client hung up — stop producing rather than finish a file nobody
      // is reading.
      source.destroy();
    },
  });
}

/** Reports a settlement without letting bookkeeping break the download. */
async function settle(
  source: TransferSource,
  error: Error | null,
  rowsWritten: number,
): Promise<void> {
  try {
    await source.onSettled?.(error, rowsWritten);
  } catch (cause) {
    logger.error('Failed to record export settlement', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Writes an .xlsx into the returned stream as rows arrive.
 *
 * `useStyles` is on only for the header row's bold run; ExcelJS warns that
 * styling costs throughput, and one styled row is worth it because an operator
 * opening a headerless-looking sheet cannot tell which column is which.
 */
function writeXlsx(source: TransferSource): ReadableStream<Uint8Array> {
  const passThrough = new PassThrough();

  const workbook = new excelStream.xlsx.WorkbookWriter({
    stream: passThrough,
    useStyles: true,
    useSharedStrings: false,
  });

  void (async () => {
    let rowsWritten = 0;
    try {
      const sheet = workbook.addWorksheet(source.sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      const header = sheet.addRow([...source.headers]);
      header.font = { bold: true };
      header.commit();

      for await (const row of source.rows()) {
        sheet.addRow([...row]).commit();
        rowsWritten += 1;
      }

      sheet.commit();
      await workbook.commit();
      await settle(source, null, rowsWritten);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      logger.error('Export stream failed', { message: error.message });
      // Destroying with the error surfaces it to the web stream's consumer,
      // which aborts the response rather than completing a truncated file.
      passThrough.destroy(error);
      await settle(source, error, rowsWritten);
    }
  })();

  return nodeToWebStream(passThrough);
}

/** Escapes one CSV field per RFC 4180. */
function csvField(value: TransferCell): string {
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Writes a CSV into the returned stream.
 *
 * Hand-rolled rather than routed through ExcelJS, whose CSV writer materialises
 * the whole worksheet before emitting anything — the one thing this module
 * exists to avoid.
 */
function writeCsv(source: TransferSource): ReadableStream<Uint8Array> {
  const passThrough = new PassThrough();

  void (async () => {
    let rowsWritten = 0;
    try {
      // BOM first: without it Excel reads a UTF-8 CSV as the local codepage and
      // mangles every accented site name.
      passThrough.write('﻿');
      passThrough.write(`${source.headers.map(csvField).join(',')}\r\n`);

      for await (const row of source.rows()) {
        const line = `${row.map(csvField).join(',')}\r\n`;
        // Respect backpressure: `write` returning false means the buffer is
        // full, and ignoring it would queue the entire export in memory.
        if (!passThrough.write(line)) {
          await new Promise<void>((resolve) => passThrough.once('drain', resolve));
        }
        rowsWritten += 1;
      }

      passThrough.end();
      await settle(source, null, rowsWritten);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      logger.error('Export stream failed', { message: error.message });
      passThrough.destroy(error);
      await settle(source, error, rowsWritten);
    }
  })();

  return nodeToWebStream(passThrough);
}

export function createTransferStream(
  format: TransferFormat,
  source: TransferSource,
): ReadableStream<Uint8Array> {
  return format === 'csv' ? writeCsv(source) : writeXlsx(source);
}

export const CONTENT_TYPES: Record<TransferFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/**
 * Builds the download filename.
 *
 * The parts are sanitised because they reach a `Content-Disposition` header,
 * where an unescaped quote or newline lets a caller forge header content.
 */
export function transferFilename(
  base: string,
  format: TransferFormat,
  parts: readonly (string | undefined)[] = [],
): string {
  const suffix = parts
    .filter((part): part is string => Boolean(part))
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter((part) => part.length > 0)
    .join('_');

  return `${base}${suffix ? `_${suffix}` : ''}.${format}`;
}
