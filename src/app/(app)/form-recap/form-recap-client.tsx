'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleAlert, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  plBet: number | null;
  validasi: number | null;
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

// The four views the toggle offers. `digits` is how many decimals each metric
// renders — PL Bet is currency (2), the counts are whole numbers (0). `signed`
// metrics can go negative, so their heat shading diverges around zero.
const METRICS = {
  deposit: { label: 'Form Deposit', short: 'Form DP', digits: 0, signed: false },
  withdraw: { label: 'Form Withdraw', short: 'Form WD', digits: 0, signed: false },
  plBet: { label: 'PL Bet', short: 'PL Bet', digits: 2, signed: true },
  validasi: { label: 'Validasi', short: 'Validasi', digits: 0, signed: false },
} as const satisfies Record<
  string,
  { label: string; short: string; digits: number; signed: boolean }
>;

type Metric = keyof typeof METRICS;

const METRIC_KEYS = Object.keys(METRICS) as Metric[];

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
const WEEKDAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

/** A cell/total value at the metric's own precision. */
function formatValue(value: number, digits: number): string {
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** An average always shows at least one decimal, so a per-day mean is not lost. */
function formatAvg(value: number, digits: number): string {
  return value.toLocaleString('id-ID', { maximumFractionDigits: Math.max(digits, 1) });
}

/** `2025-12-01` → `1-Dec-2025`, matching the operator's spreadsheet. */
function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day}-${MONTHS_SHORT[(month ?? 1) - 1]}-${year}`;
}

/** Weekday of an ISO date, computed in UTC so the viewer's timezone can't shift it. */
function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** `2025-12` → `December 2025`, for the top-left corner. */
function formatMonthTitle(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[(m ?? 1) - 1]} ${year}`;
}

function todayIso(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function currentMonth(): string {
  return todayIso().slice(0, 7);
}

/** `YYYY-MM` shifted by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year ?? 1970, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** First and last calendar day of a `YYYY-MM` month. */
function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year ?? 1970, m ?? 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * One identifying hue per site, spread evenly round the wheel — the coloured
 * header of the operator's spreadsheet, reduced to a stripe so it reads in
 * both themes without fighting the numbers.
 */
function siteHue(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return `oklch(0.7 0.15 ${hue})`;
}

/**
 * Heat shading for a cell, mixed into the page background. Counts are placed
 * between the column's own low and high, so a site's busy days stand out even
 * when its volume barely moves; signed metrics (PL Bet) shade by magnitude
 * around zero, losses in a second hue.
 */
function heatStyle(
  value: number,
  range: { min: number; max: number },
  signed: boolean,
): React.CSSProperties | undefined {
  let share: number;
  if (signed) {
    const peak = Math.max(Math.abs(range.min), Math.abs(range.max));
    share = peak > 0 ? Math.abs(value) / peak : 0;
  } else {
    const span = range.max - range.min;
    share = span > 0 ? (value - range.min) / span : 0;
  }
  if (share <= 0) return undefined;
  const tone = value < 0 ? 'var(--chart-5)' : 'var(--chart-1)';
  const pct = Math.round(share * 26);
  return { backgroundColor: `color-mix(in oklch, ${tone} ${pct}%, transparent)` };
}

const FOOT_ROW_H = 30;

// Opaque fills for the sticky footers, so scrolled rows don't show through.
const TOTAL_ROW =
  'bg-cyan-100 text-cyan-950 dark:bg-cyan-950 dark:text-cyan-50 border-t-2 border-t-cyan-700/40';
const AVG_ROW = 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-50';

export function FormRecapClient() {
  const [month, setMonth] = useState(currentMonth);
  const [metric, setMetric] = useState<Metric>('deposit');
  const [hoverSite, setHoverSite] = useState<string | null>(null);

  const { from, to } = monthRange(month);
  const today = todayIso();

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

  // Column total, reporting-day count and value range per site.
  const perSite = useMemo(() => {
    const stats: Record<
      string,
      { total: number; count: number; min: number; max: number }
    > = {};
    for (const site of sites) {
      let total = 0;
      let count = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const date of dates) {
        const value = cells[`${site.id}|${date}`]?.[metric] ?? null;
        if (value !== null) {
          total += value;
          count += 1;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      stats[site.id] = { total, count, min, max };
    }
    return stats;
  }, [sites, dates, cells, metric]);

  // Row total per date across every site; `null` when no site reported.
  const perDate = useMemo(() => {
    const totals: Record<string, number | null> = {};
    for (const date of dates) {
      let total: number | null = null;
      for (const site of sites) {
        const value = cells[`${site.id}|${date}`]?.[metric] ?? null;
        if (value !== null) total = (total ?? 0) + value;
      }
      totals[date] = total;
    }
    return totals;
  }, [sites, dates, cells, metric]);

  const summary = useMemo(() => {
    let grand = 0;
    let filled = 0;
    for (const site of sites) {
      grand += perSite[site.id]?.total ?? 0;
      filled += perSite[site.id]?.count ?? 0;
    }
    // Only days that have already happened can be missing.
    const elapsed = dates.filter((date) => date <= today).length;
    const expected = elapsed * sites.length;
    const reportingDays = dates.filter((date) => perDate[date] !== null).length;
    return {
      grand,
      filled,
      expected,
      dailyAvg: reportingDays > 0 ? grand / reportingDays : 0,
    };
  }, [sites, dates, perSite, perDate, today]);

  const config = METRICS[metric];
  const coverage =
    summary.expected > 0 ? Math.round((summary.filled / summary.expected) * 100) : null;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Rekap Form</h1>
        <p className="text-muted-foreground text-sm">
          {config.label} per site per tanggal. Warna sel menunjukkan besarnya nilai
          dibanding hari lain di site yang sama; sel bertitik berarti belum ada data.
        </p>
      </div>

      <Card className="border-border/60 z-30 p-2.5 md:sticky md:top-14">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Bulan sebelumnya"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
            >
              <ChevronLeft />
            </Button>
            <Input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value || currentMonth())}
              className="w-auto"
              aria-label="Bulan"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Bulan berikutnya"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <ChevronRight />
            </Button>
          </div>

          <div
            role="radiogroup"
            aria-label="Metrik"
            className="border-border/60 bg-muted/40 inline-flex flex-wrap rounded-md border p-0.5"
          >
            {METRIC_KEYS.map((key) => (
              <MetricButton
                key={key}
                active={metric === key}
                onClick={() => setMetric(key)}
              >
                {METRICS[key].label}
              </MetricButton>
            ))}
          </div>

          <dl className="ml-auto flex flex-wrap items-stretch gap-2">
            <Stat label={`Total ${config.short}`}>
              <span className={cn(summary.grand < 0 && 'text-destructive')}>
                {formatValue(summary.grand, config.digits)}
              </span>
            </Stat>
            <Stat label="Rata-rata / hari">
              {formatAvg(summary.dailyAvg, config.digits)}
            </Stat>
            <Stat
              label="Kelengkapan"
              hint="Sel terisi dibanding site × hari yang sudah lewat"
            >
              {coverage === null ? '—' : `${coverage}%`}
              {coverage !== null && (
                <span className="text-muted-foreground ml-1 text-xs font-normal">
                  {summary.filled}/{summary.expected}
                </span>
              )}
            </Stat>
          </dl>
        </div>
      </Card>

      {query.isError && (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>Rekap gagal dimuat</AlertTitle>
          <AlertDescription>
            {(query.error as Error).message ||
              'Periksa koneksi lalu muat ulang halaman.'}
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-border/60 overflow-hidden py-0">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : query.isError && !query.data ? (
          // The alert above already explains the failure; an empty-state
          // "no sites" here would wrongly suggest the account has none.
          <div className="text-muted-foreground py-16 text-center text-sm">
            Data tidak tersedia.
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Receipt className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada site pada cakupan ini</p>
            <p className="text-muted-foreground text-sm">
              Minta admin menugaskan site ke akun Anda untuk melihat rekapnya.
            </p>
          </div>
        ) : (
          <div
            className="relative max-h-[calc(100svh-15rem)] overflow-auto"
            onMouseLeave={() => setHoverSite(null)}
          >
            <table className="border-separate border-spacing-0 text-[12px] [&_td]:border-r [&_td]:border-b [&_th]:border-r [&_th]:border-b">
              <thead>
                <tr>
                  <th className="bg-foreground text-background sticky top-0 left-0 z-40 min-w-[108px] px-2 py-1.5 text-left font-semibold whitespace-nowrap sm:min-w-[124px]">
                    {formatMonthTitle(month)}
                  </th>
                  {sites.map((site, index) => (
                    <th
                      key={site.id}
                      title={`${site.code} — ${site.name}`}
                      style={{
                        boxShadow: `inset 0 3px 0 ${siteHue(index, sites.length)}`,
                      }}
                      className={cn(
                        'bg-muted sticky top-0 z-30 min-w-[72px] px-1.5 pt-2 pb-1.5 text-center text-[11px] font-bold tracking-wide uppercase transition-colors',
                        hoverSite === site.id && 'bg-accent-foreground text-background',
                      )}
                    >
                      {site.name}
                    </th>
                  ))}
                  <th className="bg-foreground text-background sticky top-0 z-40 min-w-[88px] px-2 py-1.5 text-right font-semibold whitespace-nowrap sm:right-0">
                    Semua site
                  </th>
                </tr>
              </thead>

              <tbody>
                {dates.map((date) => {
                  const weekday = weekdayOf(date);
                  const isToday = date === today;
                  const isFuture = date > today;
                  const rowTotal = perDate[date] ?? null;
                  return (
                    <tr
                      key={date}
                      className={cn(
                        'group',
                        isFuture && 'text-muted-foreground/60',
                        weekday === 0 && '[&>td]:border-b-border [&>td]:border-b-2',
                      )}
                    >
                      <td
                        className={cn(
                          'bg-background group-hover:bg-muted sticky left-0 z-20 px-2 py-1 whitespace-nowrap tabular-nums',
                          isToday && 'shadow-[inset_3px_0_0_var(--primary)]',
                        )}
                      >
                        <span
                          className={cn(
                            'text-muted-foreground mr-1.5 inline-block w-6 text-[11px]',
                            (weekday === 0 || weekday === 6) && 'text-chart-5',
                          )}
                        >
                          {WEEKDAYS_SHORT[weekday]}
                        </span>
                        <span className={cn('font-medium', isToday && 'font-bold')}>
                          {formatDayLabel(date)}
                        </span>
                      </td>
                      {sites.map((site) => {
                        const value = cells[`${site.id}|${date}`]?.[metric] ?? null;
                        const range = perSite[site.id];
                        return (
                          <td
                            key={site.id}
                            onMouseEnter={() => setHoverSite(site.id)}
                            style={
                              value === null || !range
                                ? undefined
                                : heatStyle(value, range, config.signed)
                            }
                            className={cn(
                              'group-hover:outline-foreground/15 px-1.5 py-1 text-right whitespace-nowrap tabular-nums group-hover:outline group-hover:-outline-offset-1',
                              hoverSite === site.id &&
                                'outline-foreground/15 outline -outline-offset-1',
                              value !== null && value < 0 && 'text-destructive',
                            )}
                          >
                            {value === null ? (
                              isFuture ? null : (
                                <span
                                  aria-label="Belum ada data"
                                  className="text-muted-foreground/40"
                                >
                                  ·
                                </span>
                              )
                            ) : (
                              formatValue(value, config.digits)
                            )}
                          </td>
                        );
                      })}
                      <td
                        className={cn(
                          'bg-muted group-hover:bg-accent z-20 px-2 py-1 text-right font-semibold whitespace-nowrap tabular-nums sm:sticky sm:right-0',
                          rowTotal !== null && rowTotal < 0 && 'text-destructive',
                        )}
                      >
                        {rowTotal === null ? '' : formatValue(rowTotal, config.digits)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr>
                  <td
                    className={cn(
                      TOTAL_ROW,
                      'sticky left-0 z-40 px-2 text-left font-bold',
                    )}
                    style={{ bottom: FOOT_ROW_H, height: FOOT_ROW_H }}
                  >
                    TOTAL
                  </td>
                  {sites.map((site) => (
                    <td
                      key={site.id}
                      className={cn(
                        TOTAL_ROW,
                        'sticky z-30 px-1.5 text-right font-semibold whitespace-nowrap tabular-nums',
                      )}
                      style={{ bottom: FOOT_ROW_H, height: FOOT_ROW_H }}
                    >
                      {formatValue(perSite[site.id]?.total ?? 0, config.digits)}
                    </td>
                  ))}
                  <td
                    className={cn(
                      TOTAL_ROW,
                      'sticky z-40 px-2 text-right font-bold whitespace-nowrap tabular-nums sm:right-0',
                    )}
                    style={{ bottom: FOOT_ROW_H, height: FOOT_ROW_H }}
                  >
                    {formatValue(summary.grand, config.digits)}
                  </td>
                </tr>
                <tr>
                  <td
                    className={cn(
                      AVG_ROW,
                      'sticky bottom-0 left-0 z-40 px-2 text-left font-bold',
                    )}
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
                        className={cn(
                          AVG_ROW,
                          'sticky bottom-0 z-30 px-1.5 text-right font-semibold whitespace-nowrap tabular-nums',
                        )}
                        style={{ height: FOOT_ROW_H }}
                      >
                        {formatAvg(avg, config.digits)}
                      </td>
                    );
                  })}
                  <td
                    className={cn(
                      AVG_ROW,
                      'sticky bottom-0 z-40 px-2 text-right font-bold whitespace-nowrap tabular-nums sm:right-0',
                    )}
                    style={{ height: FOOT_ROW_H }}
                  >
                    {formatAvg(summary.dailyAvg, config.digits)}
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

function Stat({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      title={hint}
      className="border-border/60 bg-muted/40 flex flex-col justify-center rounded-md border px-2.5 py-1"
    >
      <dt className="text-muted-foreground text-[11px] leading-tight">{label}</dt>
      <dd className="text-sm leading-tight font-semibold tabular-nums">{children}</dd>
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
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-ring/50 rounded px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 sm:py-1',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
