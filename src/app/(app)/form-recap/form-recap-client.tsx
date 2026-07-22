'use client';

import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
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
  deposit: number | null;
  withdraw: number | null;
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

type Metric = 'deposit' | 'withdraw';

// Stable fallbacks: a fresh `[]`/`{}` each render would change the identity the
// memo dependency arrays compare against, recomputing on every render.
const NO_DATES: string[] = [];
const NO_SITES: SiteRef[] = [];
const NO_CELLS: Record<string, Cell> = {};

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const intFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const avgFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** `2025-12-01` → `1-Dec-2025`, matching the operator's spreadsheet. */
function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day}-${MONTHS_SHORT[(month ?? 1) - 1]}-${year}`;
}

/** `2025-12` → `December 2025`, for the top-left corner. */
function formatMonthTitle(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[(m ?? 1) - 1]} ${year}`;
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

/** An evenly-spread, readable header colour per column — the spreadsheet look. */
function headerStyle(index: number, total: number): React.CSSProperties {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return { backgroundColor: `hsl(${hue}, 68%, 78%)`, color: '#111' };
}

const FOOT_ROW_H = 30;

export function FormRecapClient() {
  const [month, setMonth] = useState(currentMonth);
  const [metric, setMetric] = useState<Metric>('deposit');

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

  const dates = query.data?.dates ?? NO_DATES;
  const sites = query.data?.sites ?? NO_SITES;
  const cells = query.data?.cells ?? NO_CELLS;

  // Column total and reporting-day count per site, for the selected metric.
  const perSite = useMemo(() => {
    const stats: Record<string, { total: number; count: number }> = {};
    for (const site of sites) {
      let total = 0;
      let count = 0;
      for (const date of dates) {
        const value = cells[`${site.id}|${date}`]?.[metric] ?? null;
        if (value !== null) {
          total += value;
          count += 1;
        }
      }
      stats[site.id] = { total, count };
    }
    return stats;
  }, [sites, dates, cells, metric]);

  const grandTotal = useMemo(
    () => sites.reduce((sum, site) => sum + (perSite[site.id]?.total ?? 0), 0),
    [sites, perSite],
  );

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Rekap Form DP &amp; WD</h1>
        <p className="text-muted-foreground text-sm">
          Jumlah Form {metric === 'deposit' ? 'Deposit' : 'Withdraw'} per site per
          tanggal. Sel kosong berarti belum ada laporan hari itu.
        </p>
      </div>

      <Card className="border-border/60 sticky top-14 z-30 p-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonth())}
            className="w-auto"
            aria-label="Bulan"
          />

          <div className="border-border/60 bg-muted/40 inline-flex rounded-md border p-0.5">
            <MetricButton
              active={metric === 'deposit'}
              onClick={() => setMetric('deposit')}
            >
              Form Deposit
            </MetricButton>
            <MetricButton
              active={metric === 'withdraw'}
              onClick={() => setMetric('withdraw')}
            >
              Form Withdraw
            </MetricButton>
          </div>

          <div className="border-border/60 bg-muted/40 ml-auto flex items-baseline gap-1.5 rounded-md border px-2.5 py-1">
            <span className="text-muted-foreground text-xs">
              Total Form {metric === 'deposit' ? 'DP' : 'WD'}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {intFormat.format(grandTotal)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="border-border/60 overflow-hidden py-0">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Receipt className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada site pada cakupan ini</p>
          </div>
        ) : (
          <div className="relative max-h-[calc(100svh-15rem)] overflow-auto">
            <table className="border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className="bg-foreground text-background sticky top-0 left-0 z-40 min-w-[92px] border px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                    {formatMonthTitle(month)}
                  </th>
                  {sites.map((site, index) => (
                    <th
                      key={site.id}
                      title={`${site.code} — ${site.name}`}
                      style={headerStyle(index, sites.length)}
                      className="sticky top-0 z-30 min-w-[68px] border px-1 py-1.5 text-center text-[11px] font-bold uppercase"
                    >
                      {site.name}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {dates.map((date) => (
                  <tr key={date} className="hover:bg-muted/30">
                    <td className="bg-background sticky left-0 z-20 border px-2 py-1 font-medium whitespace-nowrap tabular-nums">
                      {formatDayLabel(date)}
                    </td>
                    {sites.map((site) => {
                      const value = cells[`${site.id}|${date}`]?.[metric] ?? null;
                      return (
                        <td
                          key={site.id}
                          className="border px-1.5 py-1 text-right tabular-nums"
                        >
                          {value === null ? '' : intFormat.format(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr>
                  <td
                    className="sticky left-0 z-40 border bg-cyan-200 px-2 text-center font-bold text-cyan-950"
                    style={{ bottom: FOOT_ROW_H, height: FOOT_ROW_H }}
                  >
                    TOTAL
                  </td>
                  {sites.map((site) => (
                    <td
                      key={site.id}
                      className="sticky z-30 border bg-cyan-200 px-1.5 text-right font-semibold text-cyan-950 tabular-nums"
                      style={{ bottom: FOOT_ROW_H, height: FOOT_ROW_H }}
                    >
                      {intFormat.format(perSite[site.id]?.total ?? 0)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td
                    className="sticky bottom-0 left-0 z-40 border bg-amber-200 px-2 text-center font-bold text-amber-950"
                    style={{ height: FOOT_ROW_H }}
                    title="Rata-rata per hari yang terisi"
                  >
                    RATA - RATA
                  </td>
                  {sites.map((site) => {
                    const stat = perSite[site.id] ?? { total: 0, count: 0 };
                    const avg = stat.count > 0 ? stat.total / stat.count : 0;
                    return (
                      <td
                        key={site.id}
                        className="sticky bottom-0 z-30 border bg-amber-200 px-1.5 text-right font-semibold text-amber-950 tabular-nums"
                        style={{ height: FOOT_ROW_H }}
                      >
                        {avgFormat.format(avg)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function MetricButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
