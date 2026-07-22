import { NextResponse } from 'next/server';

import { route } from '@/server/http/handler';
import { exportMonthly } from '@/server/monthly/transfer';
import { ValidationError } from '@/server/errors';
import { isTransferFormat } from '@/server/transfer/types';

/**
 * GET /api/monthly/export
 *
 * Honours the same `siteId`, `from` and `to` filters as the list endpoint, so
 * the file matches the table the operator launched it from. The body is a
 * stream: rows reach the client as they are read rather than after the whole
 * workbook has been built in memory.
 *
 * Rate limited because an export is the most expensive read in the application
 * and nothing else stops a client from firing several at once.
 */
export const GET = route({
  permission: 'monthly.export',
  rateLimit: { limit: 10, windowSeconds: 60 },
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const format = params.get('format') ?? 'xlsx';
    if (!isTransferFormat(format)) {
      throw new ValidationError('Format tidak didukung. Pilih xlsx atau csv.');
    }

    const siteIds = params.getAll('siteId');

    const download = await exportMonthly(access, {
      format,
      siteIds: siteIds.length > 0 ? siteIds : undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    });

    // A file response, not the JSON envelope: the browser is being handed a
    // download, and wrapping bytes in `{ success, data }` would defeat it.
    // Failures still take the envelope, because they are thrown before the
    // stream is created and land in the handler's error path.
    return new NextResponse(download.body, {
      headers: {
        'Content-Type': download.contentType,
        'Content-Disposition': `attachment; filename="${download.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
