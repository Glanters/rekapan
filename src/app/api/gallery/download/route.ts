import { Readable } from 'node:stream';

import archiver from 'archiver';
import { z } from 'zod';

import { env } from '@/lib/env';

import { recordAudit } from '@/server/audit/record';
import { ValidationError } from '@/server/errors';
import { resolveDownloadSet } from '@/server/gallery/service';
import { route } from '@/server/http/handler';
import { logger } from '@/server/logger';
import { storage } from '@/server/storage';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DownloadSchema = z
  .object({
    /** Explicit selection — checkbox picks in the grid. */
    imageIds: z.array(z.uuid()).max(5000).optional(),
    /** Or a filter set: by site, by date, by range, by uploader, or combined. */
    filters: z
      .object({
        siteIds: z.array(z.uuid()).optional(),
        uploaderId: z.uuid().optional(),
        category: z.enum(['MONTHLY', 'TURNOVER']).optional(),
        from: z.string().regex(ISO_DATE).optional(),
        to: z.string().regex(ISO_DATE).optional(),
        search: z.string().max(200).optional(),
      })
      .optional(),
  })
  .refine((value) => value.imageIds?.length || value.filters, {
    message: 'Pilih gambar, atau tentukan filter.',
  });

/** Strips path separators so an entry cannot escape its folder inside the archive. */
function safeEntryName(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/^\.+/, '_').slice(0, 200) || 'image';
}

/**
 * POST /api/gallery/download
 *
 * Streams a ZIP of the selected images.
 *
 * The selection is always re-derived server-side from the caller's scope — the
 * client sends ids or filters, never the storage keys. Trusting a client-supplied
 * key list would make this endpoint a way to read any object in the bucket.
 *
 * Memory is bounded by construction: entries are appended one at a time, and
 * the next object is not opened until the previous has been consumed by the
 * archiver. Opening every stream up-front would hold hundreds of connections
 * and buffer their bodies concurrently.
 */
export const POST = route({
  permission: 'gallery.download',
  bodySchema: DownloadSchema,
  handler: async ({ access, body, ip, userAgent }) => {
    const items = await resolveDownloadSet(access, {
      ...(body.imageIds ? { imageIds: body.imageIds } : {}),
      ...(body.filters ? { filters: body.filters } : {}),
    });

    if (items.length === 0) {
      throw new ValidationError('Tidak ada gambar yang cocok dengan pilihan Anda.');
    }

    // Above this count the wall-clock time to stream the archive becomes long
    // enough that a background job with a completion notification is the right
    // shape. That worker is not built yet, so the request is refused with an
    // actionable message rather than silently taking several minutes and
    // risking a proxy timeout that yields a truncated, corrupt archive.
    if (items.length > env.ZIP_SYNC_THRESHOLD * 20) {
      throw new ValidationError(
        `Pilihan ini berisi ${items.length.toLocaleString('id-ID')} gambar, terlalu besar untuk ` +
          'diunduh langsung. Persempit rentang tanggal atau filter site terlebih dahulu.',
        { count: items.length },
      );
    }

    await recordAudit({
      action: 'gallery.downloaded_zip',
      module: 'Gallery',
      actorId: access.userId,
      actorEmail: access.email,
      ip,
      userAgent,
      after: {
        count: items.length,
        mode: body.imageIds?.length ? 'selection' : 'filter',
        filters: body.filters ?? null,
      },
    });

    // Level 0: JPEG, PNG, and WebP are already compressed. Re-deflating them
    // burns CPU for a percent or two, which on a multi-gigabyte archive is
    // minutes of server time for nothing.
    const archive = archiver('zip', { zlib: { level: 0 } });

    archive.on('warning', (error: Error) => {
      logger.warn('Archive warning', { error: error.message });
    });
    archive.on('error', (error: Error) => {
      // The response headers are already sent by this point, so the status
      // cannot be changed; aborting truncates the stream, which is at least an
      // honest failure rather than a silently incomplete archive.
      logger.error('Archive failed mid-stream', { error: error.message });
      archive.abort();
    });

    const usedNames = new Set<string>();

    void (async () => {
      try {
        for (const item of items) {
          // Category, then date, then the file — no site level.
          //
          // The site is already the first component of every filename
          // (`JKT-2026-07-21-1.png`), so a folder for it would repeat what the
          // name says and split one day across as many folders as there are
          // sites. Grouping by date instead keeps a day's images together,
          // which is how they are actually reviewed.
          let entry =
            `${item.category === 'MONTHLY' ? 'monthly' : 'turnover'}/` +
            `${item.uploadDate}/${safeEntryName(item.name)}`;

          // Two uploads can share a filename; without this the archive would
          // contain duplicate entries and most extractors would keep only one.
          if (usedNames.has(entry)) {
            const dot = entry.lastIndexOf('.');
            const stem = dot > 0 ? entry.slice(0, dot) : entry;
            const ext = dot > 0 ? entry.slice(dot) : '';
            entry = `${stem}_${item.id.slice(0, 8)}${ext}`;
          }
          usedNames.add(entry);

          const objectStream = await storage.get(item.key);
          archive.append(objectStream, { name: entry });

          // Wait for the archiver to finish with this entry before opening the
          // next object. This is what bounds concurrency to one.
          await new Promise<void>((resolve) => archive.once('entry', () => resolve()));
        }

        await archive.finalize();
      } catch (error) {
        logger.error('Failed while building the archive', {
          error: error instanceof Error ? error.message : String(error),
        });
        archive.abort();
      }
    })();

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `gallery-${stamp}.zip`;

    return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Length is unknown while streaming; without this some proxies buffer
        // the whole archive to compute it, defeating the streaming entirely.
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-store',
        'X-Image-Count': String(items.length),
      },
    });
  },
});
