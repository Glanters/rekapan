import { z } from 'zod';

/**
 * Wire validation for the Monthly column endpoints. Lives outside `route.ts`
 * for the reason explained in `sites/schema.ts`.
 */

export const COLUMN_DATA_TYPES = [
  'CURRENCY',
  'DECIMAL',
  'INTEGER',
  'PERCENT',
  'TEXT',
  'DATE',
  'BOOLEAN',
] as const;

export const RESULT_EFFECTS = ['NEUTRAL', 'ADD', 'SUBTRACT', 'RESULT'] as const;

/** Indonesian labels for the column editor, kept next to the values they describe. */
export const RESULT_EFFECT_LABELS: Record<(typeof RESULT_EFFECTS)[number], string> = {
  NEUTRAL: 'Tetap — tidak memengaruhi hasil',
  ADD: 'Menambah hasil',
  SUBTRACT: 'Mengurangi hasil',
  RESULT: 'Kolom hasil — dihitung otomatis',
};

export const CreateColumnSchema = z.object({
  // Lowercased by the service. Constrained to a snake_case identifier because
  // formulas reference other columns by key and importers match on it, so a key
  // containing spaces or punctuation could not be parsed out of an expression.
  key: z
    .string()
    .min(2, 'Key minimal 2 karakter.')
    .max(64, 'Key maksimal 64 karakter.')
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*$/,
      'Key harus diawali huruf dan hanya boleh berisi huruf, angka, dan _.',
    ),
  label: z
    .string()
    .min(1, 'Label wajib diisi.')
    .max(128, 'Label maksimal 128 karakter.'),
  group: z.string().max(64, 'Grup maksimal 64 karakter.').nullable(),
  dataType: z.enum(COLUMN_DATA_TYPES),
  position: z
    .number()
    .int('Posisi harus bilangan bulat.')
    .min(0, 'Posisi tidak boleh negatif.')
    .max(100_000, 'Posisi terlalu besar.')
    .optional(),
  // Digits after the decimal point. Capped well below the Decimal(20,4) the
  // value columns actually store, so a definition cannot promise precision the
  // database will silently drop.
  precision: z
    .number()
    .int('Presisi harus bilangan bulat.')
    .min(0, 'Presisi tidak boleh negatif.')
    .max(4, 'Presisi maksimal 4 angka di belakang koma.'),
  unit: z.string().max(16, 'Satuan maksimal 16 karakter.').nullable(),
  isRequired: z.boolean(),
  isVisible: z.boolean(),
  includeInTotals: z.boolean(),
  /**
   * How the column feeds the derived Hasil. Optional on the wire and defaulted
   * to NEUTRAL, so a client that predates this field cannot accidentally
   * reclassify a column by omitting it.
   */
  resultEffect: z.enum(RESULT_EFFECTS).default('NEUTRAL'),
});

export const UpdateColumnSchema = CreateColumnSchema.partial();

export type CreateColumnValues = z.infer<typeof CreateColumnSchema>;
