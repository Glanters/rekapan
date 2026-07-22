/* eslint-disable no-console -- this is a CLI script; its output is the point */

// Must precede the env import: tsx does not load .env on its own, and
// src/lib/env.ts validates at module load, so the variables have to be present
// before that module is evaluated.
import 'dotenv/config';

import { env } from '../src/lib/env';
import {
  PERMISSIONS,
  ROLE_PRESETS,
  resolveRolePermissions,
} from '../src/server/auth/permissions';
import { unsafeDb } from '../src/server/db/prisma';

/**
 * Idempotent seed.
 *
 * Every write is an upsert keyed on a natural key, so running this against a
 * populated database repairs drift rather than duplicating rows or failing.
 * That matters because it runs on every deploy, not only on a fresh install.
 *
 *   npm run db:seed
 */

async function seedPermissions(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const permission of PERMISSIONS) {
    const row = await unsafeDb.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        module: permission.module,
        action: permission.action,
        description: permission.description,
      },
      update: {
        module: permission.module,
        action: permission.action,
        description: permission.description,
      },
      select: { id: true },
    });
    ids.set(permission.key, row.id);
  }

  console.log(`  permissions : ${ids.size}`);
  return ids;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const preset of ROLE_PRESETS) {
    const role = await unsafeDb.role.upsert({
      where: { key: preset.key },
      create: {
        key: preset.key,
        name: preset.name,
        description: preset.description,
        level: preset.level,
        isSystem: true,
      },
      update: {
        name: preset.name,
        description: preset.description,
        level: preset.level,
        isSystem: true,
      },
      select: { id: true },
    });

    const wanted = resolveRolePermissions(preset);
    const wantedIds = wanted
      .map((key) => permissionIds.get(key))
      .filter((id): id is string => id !== undefined);

    // Replace rather than merge: the preset is the declared state, so a
    // permission removed from it must actually disappear from the role.
    await unsafeDb.$transaction([
      unsafeDb.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wantedIds } },
      }),
      unsafeDb.rolePermission.createMany({
        data: wantedIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    console.log(
      `  role        : ${preset.key.padEnd(12)} ${wantedIds.length} permissions`,
    );
  }
}

const SAMPLE_SITES = [
  { code: 'JKT', name: 'Jakarta' },
  { code: 'BDG', name: 'Bandung' },
  { code: 'BALI', name: 'Bali' },
  { code: 'SBY', name: 'Surabaya' },
  { code: 'MDN', name: 'Medan' },
] as const;

async function seedSites(): Promise<void> {
  for (const site of SAMPLE_SITES) {
    await unsafeDb.site.upsert({
      where: { code: site.code },
      create: { code: site.code, name: site.name },
      update: {},
    });
  }
  console.log(`  sites       : ${SAMPLE_SITES.length}`);
}

/**
 * The Monthly columns from the customer's existing spreadsheet.
 *
 * Positions are sparse so a column can be inserted between two existing ones
 * without renumbering every row. These are starting values only — the whole
 * point of the EAV design is that administrators add and reorder columns from
 * the UI afterwards.
 */
/**
 * `effect` declares how each column feeds the derived Hasil.
 *
 * Only the unambiguous ones are pre-set: money in (ADD), money out (SUBTRACT),
 * and the result column itself. Everything analytical — turnover, kekalahan,
 * validasi, pl_bet, the form counts, the cash movements — is left NEUTRAL
 * because whether they belong in the result is an accounting decision, not one
 * to guess on the customer's behalf. They are configurable in Master Data.
 */
const MONTHLY_COLUMNS = [
  {
    key: 'pl_bet',
    label: 'PL Bet',
    group: 'Transaksi',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'validasi',
    label: 'Validasi',
    group: 'Transaksi',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'deposit',
    label: 'Deposit',
    group: 'Transaksi',
    type: 'CURRENCY',
    effect: 'ADD',
  },
  {
    key: 'withdraw',
    label: 'Withdraw',
    group: 'Transaksi',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },
  {
    key: 'hasil',
    label: 'Hasil',
    group: 'Transaksi',
    type: 'CURRENCY',
    effect: 'RESULT',
  },

  {
    key: 'form_deposit',
    label: 'Form Deposit',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'form_withdraw',
    label: 'Form Withdraw',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },

  {
    key: 'setor_kas',
    label: 'Setor Kas',
    group: 'Kas',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'pinjaman_kas',
    label: 'Pinjaman Kas',
    group: 'Kas',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },

  {
    key: 'turnover',
    label: 'Turnover',
    group: 'Turnover',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'turnover_slot',
    label: 'Turnover Slot',
    group: 'Turnover',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'turnover_livegame',
    label: 'Turnover Livegame',
    group: 'Turnover',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'turnover_sportbook',
    label: 'Turnover Sportbook',
    group: 'Turnover',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },

  {
    key: 'kekalahan_slot',
    label: 'Kekalahan Slot',
    group: 'Kekalahan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'kekalahan_livegame',
    label: 'Kekalahan Live Game',
    group: 'Kekalahan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'kekalahan_sportbook',
    label: 'Kekalahan Sportbook',
    group: 'Kekalahan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },

  {
    key: 'bonus_demo',
    label: 'Bonus Demo',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },
  {
    key: 'promo',
    label: 'Promo',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },
  {
    key: 'freechip',
    label: 'Freechip',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },
  {
    key: 'bonus_vip',
    label: 'Bonus VIP',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },
  {
    key: 'bonus_deposit',
    label: 'Bonus Deposit',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },
  {
    key: 'bonus_kpi',
    label: 'Bonus KPI',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'SUBTRACT',
  },

  {
    key: 'error',
    label: 'Error',
    group: 'Lainnya',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
] as const;

/**
 * Monthly report templates — per-brand column layouts. A site is assigned one,
 * and its reports show that template's columns plus the shared ones.
 */
const MONTHLY_TEMPLATES = [
  { code: 'PNG', name: 'PNG', position: 10 },
  { code: 'IDN', name: 'IDN', position: 20 },
] as const;

/**
 * Columns shared by every template — the common financial fields. They keep a
 * null templateId; everything else in MONTHLY_COLUMNS belongs to PNG.
 */
const SHARED_COLUMN_KEYS = new Set<string>([
  'pl_bet',
  'validasi',
  'deposit',
  'withdraw',
  'hasil',
  'form_deposit',
  'form_withdraw',
  'setor_kas',
  'turnover',
]);

/**
 * IDN's own columns, in report order. Keys are prefixed `idn_` so they stay
 * unique against PNG's. Bonus and rollingan effects are left NEUTRAL — whether
 * they feed the derived Hasil is an accounting choice, set later in Master Data,
 * mirroring the philosophy of MONTHLY_COLUMNS.
 */
const IDN_COLUMNS = [
  {
    key: 'idn_bonus_cb_livegame',
    label: 'Bonus CB Livegame 2,5% & 5%',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_cb_pragmatic',
    label: 'Bonus CB Pragmatic Play',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_cb_slot',
    label: 'Bonus CB Slot',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_cb_arcade',
    label: 'Bonus CB Arcade',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_cb_elottery',
    label: 'Bonus CB E-Lottery',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_extra_to_slot',
    label: 'Extra Turnover Slot',
    group: 'Turnover',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_scatter',
    label: 'Bonus Scatter',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_super_scatter',
    label: 'Bonus Super Scatter',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_vip',
    label: 'Bonus VIP',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_lomba_bonus',
    label: 'Lomba Bonus',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_tm_demo',
    label: 'Bonus TM / Demo Slot',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_bonus_vip',
    label: 'Form Bonus VIP',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_cb_livegame',
    label: 'Form CB Livegame 2.5% & 5%',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_cb_slot',
    label: 'Form CB Slot',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_extra_to_slot',
    label: 'Form Extra TO Slot',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_cb_pragmatic',
    label: 'Form CB Pragmatic',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_cb_arcade',
    label: 'Form CB Arcade',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_cb_elottery',
    label: 'Form CB E-Lottery',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_bonus_scatter',
    label: 'Form Bonus Scatter',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_bonus_super_scatter',
    label: 'Form Bonus Super Scatter',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_livegame',
    label: 'Rollingan Livegame',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_slot',
    label: 'Rollingan Slot',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_pragmatic',
    label: 'Rollingan Pragmatic Play',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_elottery',
    label: 'Rollingan Elottery',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_arcade',
    label: 'Rollingan Arcade',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_esports',
    label: 'Rollingan Esports',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_rollingan_sbobet',
    label: 'Rollingan Sbobet',
    group: 'Rollingan',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_bonus_kpbi',
    label: 'Bonus KPBI',
    group: 'Bonus',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_form_bonus_kpbi',
    label: 'Form Bonus KPBI',
    group: 'Form',
    type: 'INTEGER',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_pinjaman_kas_admin',
    label: 'Pinjaman dari Kas Admin',
    group: 'Kas',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
  {
    key: 'idn_setoran',
    label: 'Setoran IDN',
    group: 'Kas',
    type: 'CURRENCY',
    effect: 'NEUTRAL',
  },
] as const;

async function seedMonthlyColumns(): Promise<void> {
  // Templates first — the column and site assignments below reference them.
  const templateIdByCode = new Map<string, string>();
  for (const template of MONTHLY_TEMPLATES) {
    const row = await unsafeDb.monthlyTemplate.upsert({
      where: { code: template.code },
      create: { code: template.code, name: template.name, position: template.position },
      update: { name: template.name, position: template.position },
      select: { id: true },
    });
    templateIdByCode.set(template.code, row.id);
  }
  const pngId = templateIdByCode.get('PNG') ?? null;
  const idnId = templateIdByCode.get('IDN') ?? null;

  // Every column, tagged with the template it belongs to: shared financial keys
  // keep a null template, the rest of MONTHLY_COLUMNS is PNG's, IDN_COLUMNS is
  // IDN's.
  const catalogue = [
    ...MONTHLY_COLUMNS.map((column) => ({
      column,
      templateId: SHARED_COLUMN_KEYS.has(column.key) ? null : pngId,
    })),
    ...IDN_COLUMNS.map((column) => ({ column, templateId: idnId })),
  ];

  let position = 10;
  for (const { column, templateId } of catalogue) {
    await unsafeDb.monthlyColumn.upsert({
      where: { key: column.key },
      create: {
        key: column.key,
        label: column.label,
        group: column.group,
        dataType: column.type,
        position,
        precision: column.type === 'INTEGER' ? 0 : 2,
        resultEffect: column.effect,
        templateId,
      },
      // Position, label, and template are left alone on update: an administrator
      // may have reordered, renamed, or re-homed the column, and the seed must
      // not undo that.
      update: { group: column.group },
      select: { id: true },
    });

    // Initialise the result effect only where it is still at the default —
    // NEUTRAL is the "never configured" sentinel, so a deliberate NEUTRAL choice
    // is (imperfectly) preserved while an unconfigured column gets its intended
    // effect rather than being reset on every deploy.
    if (column.effect !== 'NEUTRAL') {
      await unsafeDb.monthlyColumn.updateMany({
        where: { key: column.key, resultEffect: 'NEUTRAL' },
        data: { resultEffect: column.effect },
      });
    }

    position += 10;
  }

  if (pngId) {
    // Columns that predate this feature carry a null template. The PNG-owned
    // ones (not shared, not IDN) are homed to PNG; only null templates are
    // touched, so a deliberate reassignment survives a re-seed.
    await unsafeDb.monthlyColumn.updateMany({
      where: {
        templateId: null,
        key: { notIn: [...SHARED_COLUMN_KEYS] },
        NOT: { key: { startsWith: 'idn_' } },
      },
      data: { templateId: pngId },
    });

    // Existing sites default to PNG — the layout they already used.
    await unsafeDb.site.updateMany({
      where: { templateId: null },
      data: { templateId: pngId },
    });
  }

  // The Validasi column sums the per-bank member breakdown, derived on read.
  // Wired only where still at the default, so a deliberate later change survives.
  await unsafeDb.monthlyColumn.updateMany({
    where: { key: 'validasi', computation: 'NONE' },
    data: { computation: 'VALIDATION_TOTAL' },
  });

  console.log(`  templates   : ${MONTHLY_TEMPLATES.length}`);
  console.log(`  monthly cols: ${MONTHLY_COLUMNS.length + IDN_COLUMNS.length}`);
}

/** Turnover games from the customer's spreadsheet; each becomes a column. */
const TURNOVER_GAMES = [
  { code: 'POIPET', name: 'Poipet', category: 'Live Game' },
  { code: 'NEVADA', name: 'Nevada', category: 'Live Game' },
  { code: 'BRUNEI', name: 'Brunei', category: 'Live Game' },
  { code: 'CHELSEA', name: 'Chelsea', category: 'Live Game' },
  { code: 'HUAHIN', name: 'Huahin', category: 'Live Game' },
  { code: 'BANGKOK', name: 'Bangkok', category: 'Live Game' },
  { code: 'TOKYO', name: 'Tokyo', category: 'Live Game' },
] as const;

async function seedTurnoverGames(): Promise<void> {
  let position = 10;

  for (const game of TURNOVER_GAMES) {
    await unsafeDb.turnoverGame.upsert({
      where: { code: game.code },
      create: {
        code: game.code,
        name: game.name,
        category: game.category,
        position,
      },
      update: { category: game.category },
    });
    position += 10;
  }

  console.log(`  games       : ${TURNOVER_GAMES.length}`);
}

/**
 * Banks members register through; each becomes a column of the per-bank
 * breakdown behind the Monthly "Validasi" figure.
 */
const BANKS = [
  { code: 'BCA', name: 'Bank Central Asia' },
  { code: 'MANDIRI', name: 'Bank Mandiri' },
  { code: 'BRI', name: 'Bank Rakyat Indonesia' },
  { code: 'BNI', name: 'Bank Negara Indonesia' },
  { code: 'CIMB', name: 'CIMB Niaga' },
] as const;

async function seedBanks(): Promise<void> {
  let position = 10;

  for (const bank of BANKS) {
    await unsafeDb.bank.upsert({
      where: { code: bank.code },
      create: {
        code: bank.code,
        name: bank.name,
        position,
      },
      // Name and position are left alone on update: an administrator may have
      // renamed or reordered the bank, and the seed must not undo that.
      update: {},
    });
    position += 10;
  }

  console.log(`  banks       : ${BANKS.length}`);
}

async function seedRootUser(): Promise<void> {
  const email = env.ROOT_EMAIL.toLowerCase();

  const rootRole = await unsafeDb.role.findUniqueOrThrow({
    where: { key: 'ROOT' },
    select: { id: true },
  });

  const user = await unsafeDb.user.upsert({
    where: { email },
    create: {
      email,
      name: 'Root',
      roleId: rootRole.id,
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
    // Repairs a root account that was locked out or demoted.
    update: { roleId: rootRole.id, status: 'ACTIVE' },
    select: { id: true },
  });

  console.log(`  root user   : ${email}`);
  console.log(`                (id ${user.id})`);
  console.log(
    '                No password is stored here — Account Center verifies the\n' +
      '                credential; this record only grants authorisation.',
  );
}

async function main(): Promise<void> {
  console.log('\nSeeding database…\n');

  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedSites();
  await seedMonthlyColumns();
  await seedTurnoverGames();
  await seedBanks();
  await seedRootUser();

  console.log('\nSeed complete.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void unsafeDb.$disconnect();
  });
