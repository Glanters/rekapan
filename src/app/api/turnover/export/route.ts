import { NextResponse } from 'next/server';

import { ValidationError } from '@/server/errors';
import { route } from '@/server/http/handler';
import { isTransferFormat } from '@/server/transfer/types';
import { exportTurnover } from '@/server/turnover/transfer';

/**
 * GET /api/turnover/export
 *
 * Honours the same `siteId`, `from` and `to` filters as the list endpoint, so
 * the file matches the table it was launched from. The body is streamed rather
 * than buffered.
 */
export const GET = route({
  permission: 'turnover.export',
  rateLimit: { limit: 10, windowSeconds: 60 },
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const format = params.get('format') ?? 'xlsx';
    if (!isTransferFormat(format)) {
      throw new ValidationError('Format tidak didukung. Pilih xlsx atau csv.');
    }

    const siteIds = params.getAll('siteId');

    const download = await exportTurnover(access, {
      format,
      siteIds: siteIds.length > 0 ? siteIds : undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    });

    // A file response rather than the JSON envelope. Failures still take the
    // envelope: they are thrown before the stream exists.
    return new NextResponse(download.body, {
      headers: {
        'Content-Type': download.contentType,
        'Content-Disposition': `attachment; filename="${download.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
