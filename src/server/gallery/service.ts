import { createHash, randomUUID } from 'node:crypto';

import sharp from 'sharp';
import type { Metadata } from 'sharp';

import { env } from '@/lib/env';

import type { ImageCategory } from '@/generated/prisma/enums';

import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { storage } from '../storage';

/**
 * Gallery: image metadata, uploads, and the queries that feed bulk downloads.
 *
 * Bytes live in object storage; this module owns only the metadata and the
 * access rules. Every read is site-scoped, so an image belonging to a site the
 * caller is not assigned to is not merely hidden from the grid — it cannot be
 * reached by guessing an id either.
 */

/**
 * Accepted formats, keyed by what `sharp` reports after actually decoding the
 * file. The browser-supplied MIME type and the filename extension are both
 * caller-controlled and are never trusted for this decision.
 */
const ACCEPTED_FORMATS: Record<string, { mime: string; extension: string }> = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
};

const THUMBNAIL_WIDTH = 480;

/** Refuses absurd dimensions before sharp allocates a buffer for them. */
const MAX_DIMENSION = 12_000;

export interface ImageDto {
  id: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  uploaderId: string;
  uploaderName: string;
  /** Which report family the image supports. */
  category: ImageCategory;
  originalName: string;
  fileName: string;
  extension: string;
  mimeType: string;
  size: number;
  cdnUrl: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  uploadDate: string;
  createdAt: string;
}

export interface GalleryFilters {
  siteIds?: readonly string[] | undefined;
  uploaderId?: string | undefined;
  category?: ImageCategory | undefined;
  from?: string | undefined;
  to?: string | undefined;
  search?: string | undefined;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"${value}" is not a valid date.`);
  }
  return parsed;
}

/**
 * Translates gallery filters into a scoped `where`.
 *
 * Shared by the grid and by every bulk-download variant, which is deliberate:
 * "download everything matching my filters" must select exactly the rows the
 * grid would show, or the download becomes a way to reach data the UI hides.
 */
export function buildImageWhere(
  ctx: AccessContext,
  filters: GalleryFilters,
): Record<string, unknown> {
  const siteIds = ctx.narrowSiteFilter(filters.siteIds);
  const search = filters.search?.trim();

  return scopedWhere(ctx, 'ImageAsset', {
    deletedAt: null,
    ...(siteIds ? { siteId: { in: [...siteIds] } } : {}),
    ...(filters.uploaderId ? { uploaderId: filters.uploaderId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.from || filters.to
      ? {
          uploadDate: {
            ...(filters.from ? { gte: fromIsoDate(filters.from) } : {}),
            ...(filters.to ? { lte: fromIsoDate(filters.to) } : {}),
          },
        }
      : {}),
    ...(search ? { originalName: { contains: search, mode: 'insensitive' } } : {}),
  });
}

const IMAGE_SELECT = {
  id: true,
  siteId: true,
  uploaderId: true,
  category: true,
  originalName: true,
  fileName: true,
  extension: true,
  mimeType: true,
  size: true,
  cdnUrl: true,
  thumbnailUrl: true,
  width: true,
  height: true,
  uploadDate: true,
  createdAt: true,
  site: { select: { code: true, name: true } },
  uploader: { select: { name: true } },
} as const;

type ImageRow = {
  id: string;
  siteId: string;
  uploaderId: string;
  category: ImageCategory;
  originalName: string;
  fileName: string;
  extension: string;
  mimeType: string;
  size: bigint;
  cdnUrl: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  uploadDate: Date;
  createdAt: Date;
  site: { code: string; name: string };
  uploader: { name: string };
};

function toDto(row: ImageRow): ImageDto {
  return {
    id: row.id,
    siteId: row.siteId,
    siteCode: row.site.code,
    siteName: row.site.name,
    uploaderId: row.uploaderId,
    uploaderName: row.uploader.name,
    category: row.category,
    originalName: row.originalName,
    fileName: row.fileName,
    extension: row.extension,
    mimeType: row.mimeType,
    // BigInt has no JSON representation; sizes are far below Number's exact
    // integer range, so the conversion is lossless here.
    size: Number(row.size),
    cdnUrl: row.cdnUrl,
    thumbnailUrl: row.thumbnailUrl,
    width: row.width,
    height: row.height,
    uploadDate: toIsoDate(row.uploadDate),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listImages(
  ctx: AccessContext,
  filters: GalleryFilters,
  pagination: { page?: number; perPage?: number } = {},
) {
  ctx.requirePermission('gallery.view');

  const page = Math.max(1, pagination.page ?? 1);
  const perPage = Math.min(120, Math.max(1, pagination.perPage ?? 40));
  const where = buildImageWhere(ctx, filters);

  const db = scopedDb(ctx);
  const [total, rows] = await Promise.all([
    db.imageAsset.count({ where }),
    db.imageAsset.findMany({
      where,
      select: IMAGE_SELECT,
      orderBy: [{ uploadDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return {
    images: rows.map(toDto),
    pagination: { page, perPage, total },
  };
}

export interface UploadInput {
  siteId: string;
  /** Monthly or Turnover — chosen by the uploader, never inferred. */
  category: ImageCategory;
  /** What the browser sent. Kept only to derive the extension. */
  originalName: string;
  bytes: Buffer;
  uploadDate?: string | undefined;
}

/**
 * Characters that must never reach a filename or a ZIP entry path.
 *
 * Declared as a Set of single characters rather than a regular-expression
 * character class on purpose. The class form needs escape sequences for the
 * backslash and the control range, and an escape that gets mangled in transit
 * produces a regex that still compiles but silently matches the wrong things.
 * `String.fromCharCode(92)` is the backslash, written so nothing has to survive
 * an escaping round trip.
 */
const RESERVED_FILENAME_CHARS = new Set([
  '/',
  String.fromCharCode(92),
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
]);

/**
 * Makes a site name safe to use inside a filename and a ZIP path.
 *
 * A site name is free text an administrator can change at any time. A slash or
 * a colon in one would carve an unintended folder into the archive — or, on
 * Windows, produce a file that cannot be extracted at all.
 *
 * Spaces and hyphens are deliberately kept: both are legal in filenames
 * everywhere, and stripping them would turn "Bank Central Asia" into
 * "BankCentralAsia" — safe, but not a name anyone would recognise.
 */
function safeSiteName(name: string): string {
  const cleaned = Array.from(name)
    .filter((char) => char.charCodeAt(0) >= 32 && !RESERVED_FILENAME_CHARS.has(char))
    .join('');

  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Site';
}

/**
 * Builds the display name: `{Nama Site}-{YYYY-MM-DD}-{n}.{ext}`.
 *
 * The site NAME, not its code: the name is what operators recognise, and the
 * code is an internal join key that means nothing to whoever opens the archive.
 *
 * The name the browser sent is discarded on purpose. A pasted screenshot has no
 * filename at all — every clipboard image arrives as `image.png` — so keeping
 * the supplied name would leave a gallery full of identical labels that say
 * nothing about which site or day they belong to.
 *
 * The sequence is the count of images already filed under the same site, date,
 * and category. Two simultaneous uploads can therefore land on the same number;
 * that is tolerable because the storage key carries a UUID, so no object is
 * overwritten, and the ZIP builder already de-duplicates repeated entry names.
 */
async function deriveDisplayName(params: {
  siteId: string;
  category: ImageCategory;
  uploadDate: Date;
  extension: string;
}): Promise<string> {
  const [site, existing] = await Promise.all([
    unsafeDb.site.findUnique({
      where: { id: params.siteId },
      select: { name: true },
    }),
    unsafeDb.imageAsset.count({
      where: {
        siteId: params.siteId,
        category: params.category,
        uploadDate: params.uploadDate,
        deletedAt: null,
      },
    }),
  ]);

  const prefix = site ? safeSiteName(site.name) : 'Site';
  return `${prefix}-${toIsoDate(params.uploadDate)}-${existing + 1}.${params.extension}`;
}

/**
 * Validates, derives a thumbnail, stores both, and records the metadata.
 *
 * Validation decodes the image rather than trusting the declared type: a file
 * named `.png` with a `image/png` header can be anything at all, and the only
 * way to know it is a PNG is to parse it.
 */
export async function uploadImage(
  ctx: AccessContext,
  input: UploadInput,
): Promise<ImageDto> {
  ctx.requirePermission('gallery.upload');
  ctx.requireSite(input.siteId);

  const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (input.bytes.byteLength > maxBytes) {
    throw new ValidationError(
      `Ukuran berkas melebihi batas ${env.MAX_UPLOAD_SIZE_MB} MB.`,
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new ValidationError('Berkas kosong.');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.bytes).metadata();
  } catch {
    throw new ValidationError('Berkas ini bukan gambar yang valid.');
  }

  const format = metadata.format ? ACCEPTED_FORMATS[metadata.format] : undefined;
  if (!format) {
    throw new ValidationError(
      `Format "${metadata.format ?? 'tidak dikenal'}" tidak didukung. Gunakan JPG, PNG, atau WEBP.`,
    );
  }

  if ((metadata.width ?? 0) > MAX_DIMENSION || (metadata.height ?? 0) > MAX_DIMENSION) {
    throw new ValidationError(
      `Dimensi gambar melebihi ${MAX_DIMENSION}px. Perkecil terlebih dahulu.`,
    );
  }

  const checksum = createHash('sha256').update(input.bytes).digest('hex');

  // Duplicate detection is per-site AND per-category: the same screenshot can
  // legitimately support both a Monthly and a Turnover report, and collapsing
  // those would leave one of the two reports with no attachment.
  const duplicate = await scopedDb(ctx).imageAsset.findFirst({
    where: scopedWhere(ctx, 'ImageAsset', {
      siteId: input.siteId,
      category: input.category,
      checksum,
      deletedAt: null,
    }),
    select: { ...IMAGE_SELECT },
  });

  if (duplicate) {
    throw new ConflictError('Gambar yang identik sudah ada di site dan kategori ini.', {
      existingId: duplicate.id,
      existingName: duplicate.originalName,
    });
  }

  const uploadDate = input.uploadDate ? fromIsoDate(input.uploadDate) : new Date();
  const datePrefix = toIsoDate(uploadDate).replace(/-/g, '/');
  const id = randomUUID();

  // Key layout is chosen for the bulk-download path: grouping by site, then
  // category, then date means "this site's Turnover images for July" is a
  // prefix rather than a scan.
  const baseKey = `public/${input.siteId}/${input.category.toLowerCase()}/${datePrefix}/${id}`;
  const originalKey = `${baseKey}.${format.extension}`;
  const thumbnailKey = `${baseKey}_thumb.webp`;

  const displayName = await deriveDisplayName({
    siteId: input.siteId,
    category: input.category,
    uploadDate,
    extension: format.extension,
  });

  const thumbnail = await sharp(input.bytes)
    .rotate() // honour EXIF orientation before discarding the metadata
    .resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  const [stored] = await Promise.all([
    storage.put(originalKey, input.bytes, { contentType: format.mime }),
    storage.put(thumbnailKey, thumbnail, { contentType: 'image/webp' }),
  ]);

  try {
    const created = await unsafeDb.imageAsset.create({
      data: {
        siteId: input.siteId,
        uploaderId: ctx.userId,
        category: input.category,
        originalName: displayName,
        fileName: originalKey,
        extension: format.extension,
        mimeType: format.mime,
        size: BigInt(input.bytes.byteLength),
        cdnUrl: stored.url,
        thumbnailUrl: storage.publicUrl(thumbnailKey),
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        checksum,
        uploadDate,
        createdById: ctx.userId,
      },
      select: IMAGE_SELECT,
    });

    await recordAudit({
      action: 'gallery.uploaded',
      module: 'Gallery',
      actorId: ctx.userId,
      actorEmail: ctx.email,
      siteId: input.siteId,
      entityType: 'ImageAsset',
      entityId: created.id,
      after: {
        name: displayName,
        // Kept for the trail: the derived name says nothing about what the
        // uploader actually picked, which matters when tracing a wrong upload.
        submittedName: input.originalName,
        category: input.category,
        size: input.bytes.byteLength,
      },
    });

    return toDto(created);
  } catch (cause) {
    // The objects are already stored; without this the bucket accumulates bytes
    // no row points at, which nothing will ever clean up.
    await storage.deleteMany([originalKey, thumbnailKey]).catch((error: unknown) =>
      logger.error('Failed to roll back orphaned objects after a failed insert', {
        originalKey,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw cause;
  }
}

export async function deleteImage(ctx: AccessContext, imageId: string) {
  ctx.requirePermission('gallery.delete');

  const image = await scopedDb(ctx).imageAsset.findFirst({
    where: scopedWhere(ctx, 'ImageAsset', { id: imageId, deletedAt: null }),
    select: { id: true, siteId: true, fileName: true, originalName: true },
  });

  if (!image) throw new NotFoundError('Gambar tidak ditemukan.');

  // Soft delete only. The stored objects are left in place so a mistaken delete
  // is recoverable; a separate sweeper reclaims bytes for rows soft-deleted
  // beyond the retention window.
  await unsafeDb.imageAsset.update({
    where: { id: imageId },
    data: { deletedAt: new Date(), updatedById: ctx.userId },
  });

  await recordAudit({
    action: 'gallery.deleted',
    module: 'Gallery',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: image.siteId,
    entityType: 'ImageAsset',
    entityId: imageId,
    before: { originalName: image.originalName },
  });

  return { id: imageId };
}

/**
 * Resolves the objects a bulk download should contain.
 *
 * Returns storage keys rather than URLs: the archive reads from storage
 * directly, so a signed URL round-trip per file is avoided, and — more
 * importantly — the selection is re-derived from the caller's scope here rather
 * than trusting a list of ids the client sent.
 */
export async function resolveDownloadSet(
  ctx: AccessContext,
  params: { filters?: GalleryFilters; imageIds?: readonly string[] },
): Promise<
  {
    id: string;
    key: string;
    name: string;
    siteCode: string;
    category: ImageCategory;
    uploadDate: string;
  }[]
> {
  ctx.requirePermission('gallery.download');

  const where = params.imageIds?.length
    ? scopedWhere(ctx, 'ImageAsset', {
        id: { in: [...params.imageIds] },
        deletedAt: null,
      })
    : buildImageWhere(ctx, params.filters ?? {});

  const rows = await scopedDb(ctx).imageAsset.findMany({
    where,
    select: {
      id: true,
      fileName: true,
      originalName: true,
      category: true,
      uploadDate: true,
      site: { select: { code: true } },
    },
    orderBy: [{ uploadDate: 'asc' }, { createdAt: 'asc' }],
    // Hard ceiling. An unbounded archive request would hold a connection open
    // for as long as it takes to stream every image the caller can see.
    take: 5000,
  });

  return rows.map((row) => ({
    id: row.id,
    key: row.fileName,
    name: row.originalName,
    siteCode: row.site.code,
    category: row.category,
    uploadDate: toIsoDate(row.uploadDate),
  }));
}

/** Distinct uploaders among images the caller can see, for the filter bar. */
export async function listUploaders(ctx: AccessContext) {
  ctx.requirePermission('gallery.view');

  const rows = await scopedDb(ctx).imageAsset.findMany({
    where: buildImageWhere(ctx, {}),
    select: { uploaderId: true, uploader: { select: { name: true } } },
    distinct: ['uploaderId'],
    take: 200,
  });

  return rows.map((row) => ({ id: row.uploaderId, name: row.uploader.name }));
}
