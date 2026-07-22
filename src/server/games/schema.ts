import { z } from 'zod';

/**
 * Wire validation for the Turnover game endpoints. Lives outside `route.ts` for
 * the reason explained in `sites/schema.ts`.
 */

export const CreateGameSchema = z.object({
  code: z
    .string()
    .min(2, 'Kode minimal 2 karakter.')
    .max(64, 'Kode maksimal 64 karakter.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh berisi huruf, angka, - dan _.'),
  name: z.string().min(1, 'Nama wajib diisi.').max(128, 'Nama maksimal 128 karakter.'),
  // Nullable rather than optional: the client must be able to clear a category,
  // and an absent field means "leave it alone" on update.
  category: z.string().max(64, 'Kategori maksimal 64 karakter.').nullable(),
  position: z
    .number()
    .int('Posisi harus bilangan bulat.')
    .min(0, 'Posisi tidak boleh negatif.')
    .max(100_000, 'Posisi terlalu besar.')
    .optional(),
  isActive: z.boolean(),
});

export const UpdateGameSchema = CreateGameSchema.partial();

export type CreateGameValues = z.infer<typeof CreateGameSchema>;
