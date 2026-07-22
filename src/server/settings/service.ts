import type { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { unsafeDb } from '../db/prisma';
import { ForbiddenError, ValidationError } from '../errors';

/**
 * Application settings.
 *
 * Deliberately a small, closed catalogue rather than a free-form key–value
 * editor. The `Setting` table can hold anything, including values the
 * application reads at boot and values that are secret; exposing it wholesale
 * would turn an admin screen into an arbitrary-write primitive over the app's
 * own configuration. Only the keys declared here are readable or writable, and
 * each carries the validation its value must satisfy.
 *
 * SECRETS. Rows flagged `isSecret` are excluded from reads at the query level —
 * not filtered out afterwards — and refused on write. Nothing declared in the
 * catalogue below is secret today; the guard exists so that a secret added to
 * the table later cannot become visible by accident.
 *
 * SCOPE. This screen manages the global row only (`siteId: null`). The schema
 * allows a per-site override and the read path honours it elsewhere; letting an
 * administrator edit another site's override from here would need the site
 * guards that belong with the site screens, so it is out of scope rather than
 * half-done.
 */

export type SettingValue = string | number;

interface SettingOption {
  readonly value: string;
  /** Display text; shown as-is in the UI. */
  readonly label: string;
}

interface BaseDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

interface SelectDefinition extends BaseDefinition {
  readonly type: 'select';
  readonly defaultValue: string;
  readonly options: readonly SettingOption[];
}

interface NumberDefinition extends BaseDefinition {
  readonly type: 'number';
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
}

export type SettingDefinition = SelectDefinition | NumberDefinition;

export const SETTING_DEFINITIONS = [
  {
    key: 'app.timezone',
    type: 'select',
    label: 'Zona waktu default',
    description: 'Dipakai saat site belum menentukan zona waktunya sendiri.',
    defaultValue: 'Asia/Jakarta',
    options: [
      { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
      { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
      { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
      { value: 'UTC', label: 'UTC' },
    ],
  },
  {
    key: 'app.currency',
    type: 'select',
    label: 'Mata uang default',
    description: 'Format nilai uang pada laporan dan ekspor.',
    defaultValue: 'IDR',
    options: [
      { value: 'IDR', label: 'IDR — Rupiah' },
      { value: 'USD', label: 'USD — Dolar AS' },
      { value: 'SGD', label: 'SGD — Dolar Singapura' },
      { value: 'MYR', label: 'MYR — Ringgit Malaysia' },
    ],
  },
  {
    key: 'app.dateFormat',
    type: 'select',
    label: 'Format tanggal',
    description: 'Tampilan tanggal di seluruh antarmuka.',
    defaultValue: 'dd/MM/yyyy',
    options: [
      { value: 'dd/MM/yyyy', label: '31/12/2026' },
      { value: 'yyyy-MM-dd', label: '2026-12-31' },
      { value: 'dd MMM yyyy', label: '31 Des 2026' },
    ],
  },
  {
    key: 'app.rowsPerPage',
    type: 'number',
    label: 'Baris per halaman',
    description: 'Jumlah baris default pada tabel yang berhalaman.',
    defaultValue: 50,
    min: 10,
    max: 200,
  },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]['key'];

const DEFINITIONS_BY_KEY = new Map<string, SettingDefinition>(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

const SETTING_KEYS: readonly string[] = SETTING_DEFINITIONS.map(
  (definition) => definition.key,
);

export interface SettingView {
  key: string;
  value: SettingValue;
  /** True when no row exists yet and the catalogue default is being shown. */
  isDefault: boolean;
  updatedAt: string | null;
}

function coerce(definition: SettingDefinition, raw: unknown): SettingValue | null {
  if (definition.type === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    return rounded < definition.min || rounded > definition.max ? null : rounded;
  }

  if (typeof raw !== 'string') return null;
  return definition.options.some((option) => option.value === raw) ? raw : null;
}

/**
 * Current values for the whole catalogue.
 *
 * A key with no row yet reports its catalogue default rather than being absent,
 * so the form always renders the value the application is actually using. A row
 * holding a value the catalogue no longer accepts — an option removed in a later
 * release — also falls back to the default instead of rendering an entry the
 * select cannot represent.
 */
export async function listSettings(ctx: AccessContext): Promise<SettingView[]> {
  ctx.requirePermission('setting.view');

  const rows = await unsafeDb.setting.findMany({
    // `isSecret: false` is part of the predicate, not a filter applied to the
    // result: a secret value must never be loaded into a response at all.
    where: { siteId: null, key: { in: [...SETTING_KEYS] }, isSecret: false },
    select: { key: true, value: true, updatedAt: true },
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));

  return SETTING_DEFINITIONS.map((definition) => {
    const row = byKey.get(definition.key);
    const stored = row ? coerce(definition, row.value) : null;

    return {
      key: definition.key,
      value: stored ?? definition.defaultValue,
      isDefault: stored === null,
      updatedAt: row && stored !== null ? row.updatedAt.toISOString() : null,
    };
  });
}

/**
 * Writes a batch of settings.
 *
 * Each value is validated against its own declaration before anything is
 * persisted, so a rejected field cannot leave the batch half-applied.
 */
export async function updateSettings(
  ctx: AccessContext,
  input: Record<string, unknown>,
): Promise<SettingView[]> {
  ctx.requirePermission('setting.update');

  const entries = Object.entries(input);

  const validated: { key: string; value: SettingValue }[] = [];
  for (const [key, raw] of entries) {
    const definition = DEFINITIONS_BY_KEY.get(key);
    if (!definition) {
      throw new ValidationError(`Setting "${key}" is not recognised.`);
    }

    const value = coerce(definition, raw);
    if (value === null) {
      throw new ValidationError(
        definition.type === 'number'
          ? `"${definition.label}" must be a whole number between ${definition.min} and ${definition.max}.`
          : `"${definition.label}" has a value that is not one of the permitted options.`,
      );
    }

    validated.push({ key, value });
  }

  if (validated.length === 0) {
    return listSettings(ctx);
  }

  // Existing rows are read *without* the isSecret filter used on the read path:
  // here the flag has to be seen in order to be refused. Filtering it out would
  // make a secret row look absent and the write would create a duplicate.
  const existing = await unsafeDb.setting.findMany({
    where: { siteId: null, key: { in: validated.map((entry) => entry.key) } },
    select: { id: true, key: true, value: true, isSecret: true },
  });

  const secret = existing.filter((row) => row.isSecret);
  if (secret.length > 0) {
    throw new ForbiddenError('Secret settings cannot be changed from this screen.', {
      keys: secret.map((row) => row.key),
    });
  }

  const existingByKey = new Map(existing.map((row) => [row.key, row]));
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  // `upsert` is unavailable here: the unique index is (key, siteId) and siteId
  // is null for global rows, which Prisma's compound unique input cannot express
  // — and in Postgres NULL never equals NULL, so the index would not dedupe them
  // anyway. Find-then-write inside one transaction is the honest equivalent.
  await unsafeDb.$transaction(async (tx) => {
    for (const entry of validated) {
      const row = existingByKey.get(entry.key);
      const definition = DEFINITIONS_BY_KEY.get(entry.key);

      before[entry.key] = row ? row.value : (definition?.defaultValue ?? null);
      after[entry.key] = entry.value;

      if (row) {
        await tx.setting.update({
          where: { id: row.id },
          data: {
            value: entry.value as Prisma.InputJsonValue,
            updatedById: ctx.userId,
          },
        });
      } else {
        await tx.setting.create({
          data: {
            key: entry.key,
            value: entry.value as Prisma.InputJsonValue,
            siteId: null,
            description: definition?.description ?? null,
            updatedById: ctx.userId,
          },
        });
      }
    }
  });

  await recordAudit({
    action: 'setting.updated',
    module: 'Setting',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Setting',
    entityId: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    before,
    after,
  });

  return listSettings(ctx);
}
