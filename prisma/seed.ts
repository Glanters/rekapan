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

async function seedMonthlyColumns(): Promise<void> {
  let position = 10;

  for (const column of MONTHLY_COLUMNS) {
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
      },
      // Position and label are left alone on update: an administrator may have
      // reordered or renamed the column, and the seed must not undo that.
      update: { group: column.group },
      select: { id: true },
    });

    // Initialise the result effect only where it is still at the default.
    // Matching on NEUTRAL is what distinguishes "never configured" from
    // "deliberately set to NEUTRAL by an administrator"... which it does not,
    // strictly — but erring toward initialising an unconfigured column is far
    // less harmful than resetting a considered choice on every deploy, which is
    // what an unconditional update would do.
    if (column.effect !== 'NEUTRAL') {
      await unsafeDb.monthlyColumn.updateMany({
        where: { key: column.key, resultEffect: 'NEUTRAL' },
        data: { resultEffect: column.effect },
      });
    }

    position += 10;
  }

  console.log(`  monthly cols: ${MONTHLY_COLUMNS.length}`);
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
