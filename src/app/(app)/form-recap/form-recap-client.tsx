'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Row {
  siteId: string;
  code: string;
  name: string;
  formDeposit: number;
  formWithdraw: number;
}

interface Result {
  from: string;
  to: string;
  rows: Row[];
  totals: { formDeposit: number; formWithdraw: number };
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

// Stable fallback: a fresh `[]` each render would change the identity the memo
// dependency array compares against, recomputing the sort on every render.
const NO_ROWS: Row[] = [];

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
function formatCount(value: number): string {
  return numberFormat.format(value);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** First and last calendar day of a `YYYY-MM` month. */
function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year ?? 1970, m ?? 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

type SortKey = 'name' | 'formDeposit' | 'formWithdraw' | 'selisih';

function selisih(row: Row): number {
  return row.formDeposit - row.formWithdraw;
}

function metric(row: Row, key: Exclude<SortKey, 'name'>): number {
  return key === 'selisih' ? selisih(row) : row[key];
}

export function FormRecapClient() {
  const [month, setMonth] = useState(currentMonth);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });

  const { from, to } = monthRange(month);

  const query = useQuery({
    queryKey: ['form-recap', { from, to }],
    queryFn: async () => {
      const search = new URLSearchParams({ from, to });
      const response = await fetch(`/api/form-recap?${search.toString()}`);
      const payload = (await response.json()) as Envelope<Result>;
      if (!payload.success) throw new Error(payload.message);
      return payload.data as Result;
    },
  });

  const rows = query.data?.rows ?? NO_ROWS;
  const totals = query.data?.totals ?? { formDeposit: 0, formWithdraw: 0 };

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    const dir = sort.dir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      let cmp: number;
      if (sort.key === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = metric(a, sort.key) - metric(b, sort.key);
        if (cmp === 0) cmp = a.name.localeCompare(b.name);
      }
      return cmp * dir;
    });
    return copy;
  }, [rows, sort]);

  // A fresh column sorts descending (most-active first); the site name ascending.
  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Rekap Form DP &amp; WD</h1>
        <p className="text-muted-foreground text-sm">
          Jumlah Form Deposit dan Form Withdraw per site untuk bulan terpilih. Semua
          site tampil di satu tabel, termasuk yang belum mengisi.
        </p>
      </div>

      <Card className="border-border/60 sticky top-14 z-20 p-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonth())}
            className="w-auto"
            aria-label="Bulan"
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <TotalChip label="Total Form DP" value={totals.formDeposit} />
            <TotalChip label="Total Form WD" value={totals.formWithdraw} />
          </div>
        </div>
      </Card>

      <Card className="border-border/60 overflow-hidden py-0">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Receipt className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada site pada cakupan ini</p>
          </div>
        ) : (
          <div className="relative max-h-[calc(100svh-16rem)] overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-background border-b">
                  <SortHeader
                    label="Site"
                    col="name"
                    sort={sort}
                    onSort={toggleSort}
                    align="left"
                    className="sticky left-0 z-20"
                  />
                  <SortHeader
                    label="Form DP"
                    col="formDeposit"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Form WD"
                    col="formWithdraw"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Selisih"
                    col="selisih"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={row.siteId}
                    className="hover:bg-muted/40 group border-b transition-colors"
                  >
                    <td className="bg-background group-hover:bg-muted/40 sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap">
                      <span className="font-mono text-xs">{row.code}</span>
                      <span className="text-muted-foreground ml-2">{row.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCount(row.formDeposit)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCount(row.formWithdraw)}
                    </td>
                    <td className="text-muted-foreground px-3 py-1.5 text-right tabular-nums">
                      {formatCount(selisih(row))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-muted/60 border-t font-semibold">
                  <td className="bg-muted/60 sticky left-0 z-20 px-3 py-2 whitespace-nowrap">
                    Total ({rows.length} site)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCount(totals.formDeposit)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCount(totals.formWithdraw)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCount(totals.formDeposit - totals.formWithdraw)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TotalChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border/60 bg-muted/40 flex items-baseline gap-1.5 rounded-md border px-2.5 py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{formatCount(value)}</span>
    </div>
  );
}

function SortHeader({
  label,
  col,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  align: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === col;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn(
        'bg-background text-muted-foreground border-b px-3 py-2 font-medium',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          'hover:text-foreground inline-flex items-center gap-1 transition-colors',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('size-3.5', !active && 'opacity-40')} />
      </button>
    </th>
  );
}
