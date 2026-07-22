import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { importMonthly } from '@/server/monthly/transfer';
import { parseSheet, readUpload } from '@/server/transfer/parse';

/**
 * POST /api/monthly/import
 *
 * Multipart upload, in two phases against the same validation pass:
 *
 *   - `?dryRun=true` parses and validates, writing nothing at all — not even an
 *     ImportJob — and returns the per-row verdicts for the operator to confirm.
 *   - Without it, the valid rows are applied inside a single transaction.
 *
 * No `bodySchema`: the pipeline's schema validation reads JSON, and this body is
 * a file. The upload is checked by `readUpload` instead.
 */
export const POST = route({
  permission: 'monthly.import',
  rateLimit: { limit: 12, windowSeconds: 60 },
  handler: async ({ access, request }) => {
    const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';

    const upload = await readUpload(request);
    const matrix = await parseSheet(upload);

    const result = await importMonthly(access, {
      matrix,
      originalName: upload.name,
      fileSize: upload.size,
      dryRun,
    });

    const message = dryRun
      ? `Pratinjau: ${result.successRows} baris siap disimpan, ${result.failedRows} baris bermasalah.`
      : `${result.successRows} baris tersimpan, ${result.failedRows} baris dilewati.`;

    return ok(result, { message });
  },
});
