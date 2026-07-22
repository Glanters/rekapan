import { z } from 'zod';

/**
 * Wire validation for the bank endpoints. Lives outside `route.ts` for the
 * reason explained in `sites/schema.ts`.
 */

export const CreateBankSchema = z.object({
  // `Bank.code` is VarChar(32), narrower than a game's, so the ceiling matches
  // the column rather than the game schema it otherwise mirrors.
  code: z
    .string()
    .min(2, 'Kode minimal 2 karakter.')
    .max(32, 'Kode maksimal 32 karakter.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh berisi huruf, angka, - dan _.'),
  name: z.string().min(1, 'Nama wajib diisi.').max(128, 'Nama maksimal 128 karakter.'),
  // Nullable rather than optional: the client must be able to clear the logo,
  // and an absent field means "leave it alone" on update.
  //
  // Deliberately not `z.url()`. Both an absolute URL and an app-relative path
  // such as `/logos/bca.png` are legitimate here, and a URL parser would reject
  // the second — so the only constraint is a length the TEXT column can hold.
  logoUrl: z.string().max(512, 'URL logo maksimal 512 karakter.').nullable(),
  position: z
    .number()
    .int('Posisi harus bilangan bulat.')
    .min(0, 'Posisi tidak boleh negatif.')
    .max(100_000, 'Posisi terlalu besar.')
    .optional(),
  isActive: z.boolean(),
});

export const UpdateBankSchema = CreateBankSchema.partial();

export type CreateBankValues = z.infer<typeof CreateBankSchema>;
