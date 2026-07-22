import type { ImageCategory } from '@/generated/prisma/enums';

import { ValidationError } from '@/server/errors';
import { listImages, listUploaders, uploadImage } from '@/server/gallery/service';
import { ok, paginated } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

/** Narrows an untrusted string to the enum, treating anything else as absent. */
function parseCategory(value: string | null): ImageCategory | undefined {
  return value === 'MONTHLY' || value === 'TURNOVER' ? value : undefined;
}

/** GET /api/gallery — one page of images the caller may see, plus filter data. */
export const GET = route({
  permission: 'gallery.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;
    const siteIds = params.getAll('siteId');

    const [result, uploaders] = await Promise.all([
      listImages(
        access,
        {
          siteIds: siteIds.length > 0 ? siteIds : undefined,
          uploaderId: params.get('uploaderId') ?? undefined,
          category: parseCategory(params.get('category')),
          from: params.get('from') ?? undefined,
          to: params.get('to') ?? undefined,
          search: params.get('search') ?? undefined,
        },
        {
          page: Number(params.get('page') ?? 1),
          perPage: Number(params.get('perPage') ?? 40),
        },
      ),
      listUploaders(access),
    ]);

    return paginated(result.images, result.pagination, { meta: { uploaders } });
  },
});

/**
 * POST /api/gallery — multipart upload.
 *
 * No `bodySchema`: the wrapper parses JSON, and this endpoint takes form data.
 * Validation happens in the service, which decodes the image rather than
 * trusting the declared content type.
 */
export const POST = route({
  permission: 'gallery.upload',
  rateLimit: RATE_LIMITS.upload,
  handler: async ({ access, request }) => {
    const form = await request.formData();

    const siteId = form.get('siteId');
    if (typeof siteId !== 'string') {
      throw new ValidationError('Site wajib dipilih.');
    }

    // Required, with no fallback: defaulting would file an unlabelled upload
    // under a category the uploader never chose, and nothing downstream could
    // tell that apart from a deliberate selection.
    const category = parseCategory(
      typeof form.get('category') === 'string'
        ? (form.get('category') as string)
        : null,
    );
    if (!category) {
      throw new ValidationError('Pilih kategori: Monthly atau Turnover.');
    }

    const uploadDate = form.get('uploadDate');
    const file = form.get('file');

    if (!(file instanceof File)) {
      throw new ValidationError('Berkas tidak ditemukan pada permintaan ini.');
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    const image = await uploadImage(access, {
      siteId,
      category,
      originalName: file.name,
      bytes,
      uploadDate: typeof uploadDate === 'string' && uploadDate ? uploadDate : undefined,
    });

    return ok(image, { message: 'Gambar diunggah.', status: 201 });
  },
});
