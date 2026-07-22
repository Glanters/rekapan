'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SiteRef {
  id: string;
  code: string;
  name: string;
}

interface Cell {
  monthly: boolean;
  turnover: boolean;
  imageMonthly: boolean;
  imageTurnover: boolean;
}

interface Result {
  from: string;
  to: string;
  dates: string[];
  sites: SiteRef[];
  cells: Record<string, Cell>;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

const EMPTY_CELL: Cell = {
  monthly: false,
  turnover: false,
  imageMonthly: false,
  imageTurnover: false,
};

// Stable fallbacks: a fresh `[]`/`{}` each render would change the identity the
// memo dependency arrays compare against, recomputing on every render.
const NO_DATES: string[] = [];
const NO_SITES: SiteRef[] = [];
const NO_CELLS: Record<string, Cell> = {};

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

function isComplete(cell: Cell): boolean {
  return cell.monthly && cell.turnover && cell.imageMonthly && cell.imageTurnover;
}

export function CompletenessClient({ sites }: { sites: SiteRef[] }) {
  const [month, setMonth] = useState(currentMonth);
  const [siteId, setSiteId] = useState('');

  const { from, to } = monthRange(month);
  const todayIso = new Date().toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['completeness', { from, to, siteId }],
    queryFn: async () => {
      const search = new URLSearchParams({ from, to });
      if (siteId) search.set('siteId', siteId);

      const response = await fetch(`/api/completeness?${search.toString()}`);
      const payload = (await response.json()) as Envelope<Result>;
      if (!payload.success) throw new Error(payload.message);
      return payload.data as Result;
    },
  });

  const dates = query.data?.dates ?? NO_DATES;
  const rows = query.data?.sites ?? NO_SITES;
  const cells = query.data?.cells ?? NO_CELLS;

  const pastDays = useMemo(
    () => dates.filter((date) => date <= todayIso).length,
    [dates, todayIso],
  );

  // Fully-complete, non-future days per site, for the summary column.
  const completeBySite = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const site of rows) {
      let done = 0;
      for (const date of dates) {
        if (date > todayIso) continue;
        const cell = cells[`${site.id}|${date}`];
        if (cell && isComplete(cell)) done += 1;
      }
      counts[site.id] = done;
    }
    return counts;
  }, [rows, dates, cells, todayIso]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Kelengkapan</h1>
        <p className="text-muted-foreground text-sm">
          Setiap kotak jadi hijau saat site menyelesaikan tugasnya pada tanggal itu —
          Monthly, Turnover, dan unggahan gambar Monthly &amp; Turnover.
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
          <select
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            aria-label="Site"
          >
            <option value="">Semua site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>

          <div className="text-muted-foreground ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <LegendKey label="Monthly" pos="tl" />
            <LegendKey label="Turnover" pos="tr" />
            <LegendKey label="Gambar M" pos="bl" />
            <LegendKey label="Gambar T" pos="br" />
          </div>
        </div>
      </Card>

      <Card className="border-border/60 overflow-hidden py-0">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CalendarCheck className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada site pada cakupan ini</p>
          </div>
        ) : (
          <div className="relative max-h-[calc(100svh-16rem)] overflow-auto">
            <table className="border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-background border-b">
                  <th className="bg-background text-muted-foreground sticky left-0 z-20 border-r px-3 py-2 text-left font-medium">
                    Site
                  </th>
                  {dates.map((date) => (
                    <th
                      key={date}
                      title={date}
                      className={cn(
                        'text-muted-foreground w-8 px-0 py-2 text-center text-[11px] font-medium tabular-nums',
                        date > todayIso && 'opacity-40',
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </th>
                  ))}
                  <th className="bg-background text-muted-foreground sticky right-0 z-20 border-l px-3 py-2 text-right font-medium whitespace-nowrap">
                    Lengkap
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((site) => (
                  <tr
                    key={site.id}
                    className="hover:bg-muted/40 group border-b transition-colors"
                  >
                    <td className="bg-background group-hover:bg-muted/40 sticky left-0 z-10 border-r px-3 py-1 font-medium whitespace-nowrap">
                      <span className="font-mono text-xs">{site.code}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {site.name}
                      </span>
                    </td>
                    {dates.map((date) => (
                      <td key={date} className="px-0 py-1 text-center">
                        <CellView
                          cell={cells[`${site.id}|${date}`]}
                          isFuture={date > todayIso}
                        />
                      </td>
                    ))}
                    <td className="bg-background group-hover:bg-muted/40 sticky right-0 z-10 border-l px-3 py-1 text-right font-semibold whitespace-nowrap tabular-nums">
                      {completeBySite[site.id] ?? 0}
                      <span className="text-muted-foreground font-normal">
                        /{pastDays}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CellView({ cell, isFuture }: { cell?: Cell; isFuture: boolean }) {
  if (isFuture) return <div className="mx-auto size-4" />;

  const value = cell ?? EMPTY_CELL;
  const title =
    `Monthly ${mark(value.monthly)} · Turnover ${mark(value.turnover)} · ` +
    `Gambar M ${mark(value.imageMonthly)} · Gambar T ${mark(value.imageTurnover)}`;

  return (
    <div
      title={title}
      className={cn(
        'mx-auto grid size-4 grid-cols-2 grid-rows-2 gap-px rounded-[3px] p-px',
        isComplete(value) && 'bg-emerald-500/20',
      )}
    >
      <Dot on={value.monthly} />
      <Dot on={value.turnover} />
      <Dot on={value.imageMonthly} />
      <Dot on={value.imageTurnover} />
    </div>
  );
}

function mark(done: boolean): string {
  return done ? '✓' : '—';
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={cn('rounded-[1px]', on ? 'bg-emerald-500' : 'bg-muted-foreground/20')}
    />
  );
}

const LEGEND_POS: Record<string, string> = {
  tl: 'col-start-1 row-start-1',
  tr: 'col-start-2 row-start-1',
  bl: 'col-start-1 row-start-2',
  br: 'col-start-2 row-start-2',
};

function LegendKey({ label, pos }: { label: string; pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <span className="flex items-center gap-1">
      <span className="grid size-4 grid-cols-2 grid-rows-2 gap-px rounded-[3px] p-px">
        <span className={cn('rounded-[1px] bg-emerald-500', LEGEND_POS[pos])} />
      </span>
      {label}
    </span>
  );
}
