import { NextResponse } from 'next/server';

import { ValidationError } from '@/server/errors';
import { route } from '@/server/http/handler';
import { isTransferFormat } from '@/server/transfer/types';
import { turnoverTemplate } from '@/server/turnover/transfer';

/**
 * GET /api/turnover/template
 *
 * An empty workbook whose headers are the active game codes. The importer
 * refuses headers it does not recognise, so this is how an operator gets the
 * exact spelling rather than guessing at it.
 */
export const GET = route({
  permission: 'turnover.import',
  rateLimit: { limit: 20, windowSeconds: 60 },
  handler: async ({ access, request }) => {
    const format = request.nextUrl.searchParams.get('format') ?? 'xlsx';
    if (!isTransferFormat(format)) {
      throw new ValidationError('Format tidak didukung. Pilih xlsx atau csv.');
    }

    const download = await turnoverTemplate(access, format);

    return new NextResponse(download.body, {
      headers: {
        'Content-Type': download.contentType,
        'Content-Disposition': `attachment; filename="${download.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
