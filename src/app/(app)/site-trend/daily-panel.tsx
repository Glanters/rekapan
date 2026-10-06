'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { compareValues } from '@/server/site-trend/compare';
import type {
  SiteTrendDailyMetric,
  SiteTrendDailyResult,
} from '@/server/site-trend/daily';

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function monthLabel(isoDate: string): string {
  return MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? '';
}

function weekday(isoMonthStart: string, day: number): string {
  const date = new Date(
    `${isoMonthStart.slice(0, 8)}${String(day).padStart(2, '0')}T00:00:00Z`,
  );
  return WEEKDAYS[date.getUTCDay()] ?? '';
}

function format(value: number | null, digits: number): string {
  if (value === null) return '—';
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPct(ratio: number | null, direction: string): string {
  if (direction === 'new') return 'baru';
  if (direction === 'gone') return 'hilang';
  if (ratio === null) return '';
  const pct = ratio * 100;
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('id-ID', { maximumFractionDigits: 0 })}%`;
}

/**
 * One site, one metric, day by day: this month beside the same day of the
 * month before. The paired bars make the day a slide began visible at a glance;
 * the table underneath carries the exact figures.
 */
export function DailyPanel({
  siteId,
  month,
  metricId,
  onMetric,
}: {
  siteId: string;
  month: string;
  metricId: string | null;
  onMetric: (metricId: string) => void;
}) {
  const query = useQuery({
    queryKey: ['site-trend-daily', siteId, month],
    queryFn: async () => {
      const response = await fetch(`/api/site-trend/${siteId}?month=${month}`);
      const payload = (await response.json()) as Envelope<SiteTrendDailyResult>;
      if (!payload.success) throw new Error(payload.message);
      return payload.data as SiteTrendDailyResult;
    },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-2 px-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p className="text-muted-foreground px-4 text-sm">
        {(query.error as Error | null)?.message ?? 'Data harian gagal dimuat.'}
      </p>
    );
  }

  const data = query.data;
  if (data.metrics.length === 0) {
    return (
      <p className="text-muted-foreground px-4 text-sm">
        Belum ada data harian untuk site ini.
      </p>
    );
  }
  const metric: SiteTrendDailyMetric =
    data.metrics.find((m) => m.id === metricId) ?? data.metrics[0]!;

  const curMonth = monthLabel(data.current.from);
  const prevMonth = monthLabel(data.previous.from);
  const peak = Math.max(
    0,
    ...metric.current.map((v) => Math.abs(v ?? 0)),
    ...metric.previous.map((v) => Math.abs(v ?? 0)),
  );

  const rows = data.days.map((day, i) => {
    const cur = metric.current[i] ?? null;
    const prev = metric.previous[i] ?? null;
    // Only compare a day both months filed; a gap on either side is shown as
    // a gap, not as a 100% move.
    const change =
      cur !== null && prev !== null
        ? compareValues(cur, prev, metric.higherIsWorse)
        : null;
    return { day, cur, prev, change };
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <span id={`daily-metric-${siteId}`} className="text-muted-foreground text-xs">
          Bagian
        </span>
        {/* The app's Select rather than a native <select>: native option lists
            ignore the dark theme on Windows and render white on white. */}
        <Select
          items={Object.fromEntries(
            data.metrics.map((m) => [
              m.id,
              m.group ? `${m.label} · ${m.group}` : m.label,
            ]),
          )}
          value={metric.id}
          onValueChange={(value) => {
            if (value) onMetric(value);
          }}
        >
          <SelectTrigger
            aria-labelledby={`daily-metric-${siteId}`}
            className="min-w-0 flex-1 sm:w-64 sm:flex-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.metrics.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.group ? `${m.label} · ${m.group}` : m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="bg-muted-foreground/35 inline-block h-2 w-3 rounded-sm" />
            {prevMonth}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="bg-chart-1 inline-block h-2 w-3 rounded-sm" />
            {curMonth}
          </span>
        </span>
      </div>

      {/* Paired bars per day — previous month muted, this month in colour.
          Hidden from screen readers: the table below carries the same data. */}
      {peak === 0 ? (
        <p className="text-muted-foreground mx-4 rounded-md border border-dashed py-6 text-center text-sm">
          Semua nilai {metric.label} pada kedua periode adalah 0.
        </p>
      ) : (
        <div className="px-4" aria-hidden>
          <div className="flex h-24 items-end gap-px border-b">
            {rows.map((row) => (
              <div
                key={row.day}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-px"
                title={`Tgl ${row.day}: ${prevMonth} ${format(row.prev, metric.digits)} · ${curMonth} ${format(row.cur, metric.digits)}`}
              >
                <span
                  className="bg-muted-foreground/35 w-1/2 max-w-2 rounded-t-[1px]"
                  style={{ height: `${(Math.abs(row.prev ?? 0) / peak) * 100}%` }}
                />
                <span
                  className={cn(
                    'w-1/2 max-w-2 rounded-t-[1px]',
                    row.change?.favourable === false
                      ? 'bg-red-500'
                      : row.change?.favourable === true
                        ? 'bg-emerald-500'
                        : 'bg-chart-1',
                  )}
                  style={{ height: `${(Math.abs(row.cur ?? 0) / peak) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="text-muted-foreground flex justify-between pt-1 text-[10px] tabular-nums">
            <span>1</span>
            <span>{data.days.length}</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto px-4 sm:max-h-80 sm:overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-card sticky top-0">
            <tr className="text-muted-foreground text-left">
              <th className="py-1 font-medium">Tanggal</th>
              <th className="py-1 text-right font-medium">{prevMonth}</th>
              <th className="py-1 text-right font-medium">{curMonth}</th>
              <th className="py-1 text-right font-medium">Perubahan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rose =
                row.change?.direction === 'up' || row.change?.direction === 'new';
              const fell =
                row.change?.direction === 'down' || row.change?.direction === 'gone';
              return (
                <tr
                  key={row.day}
                  className={cn(
                    'border-t',
                    row.change?.favourable === false && 'bg-red-500/5',
                  )}
                >
                  <td className="py-1 pr-2 whitespace-nowrap tabular-nums">
                    <span className="text-muted-foreground inline-block w-7">
                      {weekday(data.current.from, row.day)}
                    </span>
                    {row.day}
                  </td>
                  <td className="text-muted-foreground py-1 pl-3 text-right whitespace-nowrap tabular-nums">
                    {format(row.prev, metric.digits)}
                  </td>
                  <td className="py-1 pl-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {format(row.cur, metric.digits)}
                  </td>
                  <td
                    className={cn(
                      'py-1 pl-2 text-right font-semibold whitespace-nowrap tabular-nums',
                      row.change?.favourable === true &&
                        'text-emerald-700 dark:text-emerald-400',
                      row.change?.favourable === false &&
                        'text-red-700 dark:text-red-400',
                      !row.change?.significant && 'text-muted-foreground font-normal',
                    )}
                  >
                    {row.change === null ? (
                      <span className="text-muted-foreground font-normal">
                        {row.cur === null && row.prev === null
                          ? ''
                          : row.cur === null
                            ? 'belum diisi'
                            : 'tidak ada pembanding'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5">
                        {row.change.significant && rose && (
                          <ArrowUp className="size-3" />
                        )}
                        {row.change.significant && fell && (
                          <ArrowDown className="size-3" />
                        )}
                        {formatPct(row.change.ratio, row.change.direction)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
