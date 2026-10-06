import { describe, expect, it, vi } from 'vitest';

// The commit only touches the transaction client it is handed; the module-level
// clients are stubbed so importing the service needs no database.
vi.mock('../db/prisma', () => ({ scopedDb: vi.fn(), unsafeDb: {} }));
// The service's import graph validates the full environment on load; nothing
// under test reads it, so a stand-in keeps the test free of a real `.env`.
vi.mock('@/lib/env', () => ({
  env: new Proxy({}, { get: () => 'test' }),
  encryptionKeyBytes: Buffer.alloc(32),
  isProduction: false,
  isDevelopment: false,
  isTest: true,
}));

import type { AccessContext } from '../auth/access-context';

import { commitMonthlyUpsert, type MonthlyWritePlan } from './service';

function fakeTx(previous: {
  values?: {
    columnId: string;
    valueNumeric: number | null;
    valueText?: string | null;
  }[];
  banks?: { bankId: string; memberCount: number }[];
}) {
  const writes: string[] = [];
  const tx = {
    monthlyValue: {
      findMany: vi.fn(async () =>
        (previous.values ?? []).map((v) => ({
          columnId: v.columnId,
          valueNumeric: v.valueNumeric,
          valueText: v.valueText ?? null,
          valueDate: null,
          valueBool: null,
        })),
      ),
      upsert: vi.fn(async () => writes.push('value')),
    },
    monthlyValidation: {
      findMany: vi.fn(async () => previous.banks ?? []),
      upsert: vi.fn(async () => writes.push('bank')),
      deleteMany: vi.fn(async () => undefined),
    },
    monthlyReport: {
      update: vi.fn(async () => ({ id: 'report-1' })),
      create: vi.fn(async () => ({ id: 'report-new' })),
    },
  };
  return { tx: tx as never, writes };
}

const ctx = { userId: 'user-1' } as AccessContext;

function plan(overrides: Partial<MonthlyWritePlan>): MonthlyWritePlan {
  return {
    siteId: 'site-1',
    reportDate: new Date('2026-07-01T00:00:00Z'),
    note: undefined,
    values: [],
    validations: null,
    existingId: 'report-1',
    ...overrides,
  };
}

const num = (n: number | null) => ({
  valueNumeric: n,
  valueText: null,
  valueDate: null,
  valueBool: null,
});

describe('commitMonthlyUpsert change tracking', () => {
  it('reports only the cells whose value changed, with before and after', async () => {
    const { tx } = fakeTx({
      values: [
        { columnId: 'deposit', valueNumeric: 10_000_000 },
        { columnId: 'withdraw', valueNumeric: 4_000_000 },
      ],
    });

    const result = await commitMonthlyUpsert(
      tx,
      ctx,
      plan({
        values: [
          { columnId: 'deposit', data: num(8_000_000) },
          { columnId: 'withdraw', data: num(4_000_000) },
          { columnId: 'setor_kas', data: num(500) },
        ],
      }),
    );

    expect(result.created).toBe(false);
    expect(result.changes).toEqual([
      { columnId: 'deposit', before: 10_000_000, after: 8_000_000 },
      { columnId: 'setor_kas', before: null, after: 500 },
    ]);
  });

  it('records a cleared cell as a change to null', async () => {
    const { tx } = fakeTx({ values: [{ columnId: 'deposit', valueNumeric: 1 }] });
    const result = await commitMonthlyUpsert(
      tx,
      ctx,
      plan({ values: [{ columnId: 'deposit', data: num(null) }] }),
    );
    expect(result.changes).toEqual([{ columnId: 'deposit', before: 1, after: null }]);
  });

  it('tracks per-bank counts, including a bank removed from the breakdown', async () => {
    const { tx } = fakeTx({
      banks: [
        { bankId: 'bca', memberCount: 40 },
        { bankId: 'bni', memberCount: 5 },
      ],
    });
    const result = await commitMonthlyUpsert(
      tx,
      ctx,
      plan({ validations: [{ bankId: 'bca', memberCount: 45 }] }),
    );
    expect(result.bankChanges).toEqual([
      { bankId: 'bca', before: 40, after: 45 },
      { bankId: 'bni', before: 5, after: null },
    ]);
  });

  it('treats every entered cell of a new report as a change from nothing', async () => {
    const { tx } = fakeTx({});
    const result = await commitMonthlyUpsert(
      tx,
      ctx,
      plan({ existingId: null, values: [{ columnId: 'deposit', data: num(7) }] }),
    );
    expect(result.created).toBe(true);
    expect(result.changes).toEqual([{ columnId: 'deposit', before: null, after: 7 }]);
  });
});
