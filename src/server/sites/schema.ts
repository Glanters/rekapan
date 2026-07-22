import { z } from 'zod';

/**
 * Wire validation for the site endpoints.
 *
 * Kept out of the route files on purpose: `route.ts` modules are Next.js
 * entrypoints and may only export HTTP methods and route config, so the create
 * and update schemas cannot be shared between the collection and item routes
 * from there.
 *
 * Trimming and case normalisation are the service's job, not the schema's, so
 * the parsed type matches the input type exactly and one rule governs both
 * create and update.
 */

export const SITE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export const CreateSiteSchema = z.object({
  // Restricted to identifier characters because the code is the join key
  // operators type into Excel imports, where a stray space or accent silently
  // fails to match rather than reporting an error.
  code: z
    .string()
    .min(2, 'Kode minimal 2 karakter.')
    .max(32, 'Kode maksimal 32 karakter.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh berisi huruf, angka, - dan _.'),
  name: z.string().min(1, 'Nama wajib diisi.').max(191, 'Nama maksimal 191 karakter.'),
  timezone: z
    .string()
    .min(1, 'Zona waktu wajib diisi.')
    .max(64, 'Zona waktu maksimal 64 karakter.'),
  currency: z
    .string()
    .min(3, 'Mata uang minimal 3 karakter.')
    .max(8, 'Mata uang maksimal 8 karakter.'),
  status: z.enum(SITE_STATUSES),
  /**
   * The Monthly template this site's reports use. Null clears it, falling back
   * to the shared columns; omitted leaves it unchanged on update.
   */
  templateId: z.uuid().nullable().optional(),
});

export const UpdateSiteSchema = CreateSiteSchema.partial();

export type CreateSiteValues = z.infer<typeof CreateSiteSchema>;
