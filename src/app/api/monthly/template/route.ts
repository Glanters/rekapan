import { NextResponse } from 'next/server';

import { ValidationError } from '@/server/errors';
import { route } from '@/server/http/handler';
import { monthlyTemplate } from '@/server/monthly/transfer';
import { isTransferFormat } from '@/server/transfer/types';

/**
 * GET /api/monthly/template
 *
 * An empty workbook whose headers are derived from `monthly_columns`. This is
 * what makes the import usable in practice — the importer refuses headers it
 * does not recognise, so an operator needs the exact spelling rather than a
 * guess at it.
 */
export const GET = route({
  permission: 'monthly.import',
  rateLimit: { limit: 20, windowSeconds: 60 },
  handler: async ({ access, request }) => {
    const format = request.nextUrl.searchParams.get('format') ?? 'xlsx';
    if (!isTransferFormat(format)) {
      throw new ValidationError('Format tidak didukung. Pilih xlsx atau csv.');
    }

    const download = await monthlyTemplate(access, format);

    return new NextResponse(download.body, {
      headers: {
        'Content-Type': download.contentType,
        'Content-Disposition': `attachment; filename="${download.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
