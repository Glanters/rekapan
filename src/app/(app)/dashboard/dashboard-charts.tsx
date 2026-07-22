'use client';

import { ChartNoAxesColumn } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';

import { formatCompact, formatRupiah, formatShortDate } from './format';
import type {
  DashboardSeriesPoint,
  DashboardSiteBreakdown,
  DashboardTopGame,
} from './types';

/**
 * Dashboard charts.
 *
 * THEMING. Every colour is a `var(--…)` reference, never a literal. Recharts
 * writes its colours into SVG presentation attributes, which resolve CSS
 * custom properties like any other declaration, so a series painted with
 * `var(--chart-1)` re-paints itself when the `.dark` class flips — with no
 * `useTheme`, no re-render, and no flash of the wrong palette during hydration.
 * That last point is the reason for doing it this way rather than reading the
 * resolved theme in React: the server has no idea which theme will apply, so
 * any JS-side branch renders the wrong colours first and corrects them after.
 *
 * SIZING. Charts are the one place a Tailwind-only layout does not reach —
 * Recharts needs a pixel height to lay out against, so each container declares
 * one explicitly rather than inheriting an ambiguous `100%`.
 */

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const GRID_STROKE = 'var(--border)';

// ============================================================================
// SHARED CHROME
// ============================================================================

interface TooltipEntry {
  name?: string | number;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Turns the axis value into the tooltip heading. */
  labelFormatter?: (label: string) => string;
}

/**
 * Tooltip body.
 *
 * Plain HTML with the popover tokens rather than Recharts' default box, which
 * ships hard-coded white and is unreadable in dark mode.
 */
function ChartTooltip({ active, label, payload, labelFormatter }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const heading =
    label === undefined
      ? null
      : labelFormatter
        ? labelFormatter(String(label))
        : String(label);

  return (
    <div className="bg-popover text-popover-foreground ring-foreground/10 rounded-lg px-3 py-2 text-xs shadow-md ring-1">
      {heading && <p className="mb-1.5 font-medium">{heading}</p>}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li
            key={`${String(entry.dataKey)}-${index}`}
            className="flex items-center gap-2"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {formatRupiah(Number(entry.value ?? 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LegendEntry {
  label: string;
  color: string;
}

export function ChartLegend({ entries }: { entries: readonly LegendEntry[] }) {
  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * What a chart shows instead of axes when it has nothing to plot.
 *
 * A zeroed dataset still draws: a flat line pinned to the baseline, or a row of
 * bars with no length. Both look like a rendering failure rather than an
 * absence of data, so a chart with nothing in it says so in words.
 */
export function ChartEmpty({ message, height }: { message: string; height: number }) {
  return (
    <div
      className="text-muted-foreground flex flex-col items-center justify-center gap-2 text-center"
      style={{ height }}
    >
      <ChartNoAxesColumn className="size-6 opacity-40" aria-hidden />
      <p className="max-w-[28ch] text-xs">{message}</p>
    </div>
  );
}

/** True when every plotted value is zero, i.e. there is nothing to look at. */
function isFlat(values: readonly number[]): boolean {
  return values.every((value) => value === 0);
}

// ============================================================================
// DEPOSIT VS WITHDRAW
// ============================================================================

export const CASHFLOW_HEIGHT = 260;

export const CASHFLOW_LEGEND: readonly LegendEntry[] = [
  { label: 'Deposit', color: 'var(--chart-1)' },
  { label: 'Withdraw', color: 'var(--chart-5)' },
];

export function CashflowChart({ series }: { series: readonly DashboardSeriesPoint[] }) {
  if (isFlat(series.flatMap((point) => [point.deposit, point.withdraw]))) {
    return (
      <ChartEmpty
        height={CASHFLOW_HEIGHT}
        message="Belum ada deposit atau withdraw yang tercatat pada periode ini."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={CASHFLOW_HEIGHT}>
      <AreaChart data={[...series]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {/* Gradients cannot take a CSS variable as a `stop-color` shorthand,
              but they can as an explicit stopColor attribute — same resolution
              path, so these stay theme-aware too. */}
          <linearGradient id="dash-deposit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="dash-withdraw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={formatCompact}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          content={<ChartTooltip labelFormatter={formatShortDate} />}
          cursor={{ stroke: GRID_STROKE }}
        />
        <Area
          type="monotone"
          dataKey="deposit"
          name="Deposit"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#dash-deposit)"
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="withdraw"
          name="Withdraw"
          stroke="var(--chart-5)"
          strokeWidth={2}
          fill="url(#dash-withdraw)"
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// TURNOVER TREND
// ============================================================================

export const TURNOVER_HEIGHT = 220;

export const TURNOVER_LEGEND: readonly LegendEntry[] = [
  { label: 'Turnover harian', color: 'var(--chart-2)' },
];

export function TurnoverTrendChart({
  series,
}: {
  series: readonly DashboardSeriesPoint[];
}) {
  if (isFlat(series.map((point) => point.turnover))) {
    return (
      <ChartEmpty
        height={TURNOVER_HEIGHT}
        message="Belum ada turnover yang tercatat pada periode ini."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={TURNOVER_HEIGHT}>
      <AreaChart data={[...series]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="dash-turnover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={formatCompact}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          content={<ChartTooltip labelFormatter={formatShortDate} />}
          cursor={{ stroke: GRID_STROKE }}
        />
        <Area
          type="monotone"
          dataKey="turnover"
          name="Turnover"
          stroke="var(--chart-2)"
          strokeWidth={2}
          fill="url(#dash-turnover)"
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// PROFIT BY SITE
// ============================================================================

/** Grows with the number of sites so the bars keep a usable thickness. */
export function barChartHeight(rows: number): number {
  return Math.max(140, Math.min(360, rows * 34 + 40));
}

export function ProfitBySiteChart({
  sites,
}: {
  sites: readonly DashboardSiteBreakdown[];
}) {
  // Ranked here rather than in SQL: the query orders by turnover, which is what
  // the site table beside this chart is sorted by. Re-sorting a list already
  // capped at 25 rows is not the kind of client-side work this page avoids.
  const data = [...sites].sort((a, b) => b.profit - a.profit);
  const height = barChartHeight(data.length);

  if (data.length === 0 || isFlat(data.map((site) => site.profit))) {
    return (
      <ChartEmpty
        height={height}
        message="Belum ada profit yang dapat dihitung. Profit berasal dari deposit dikurangi withdraw."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
        barCategoryGap="25%"
      >
        <CartesianGrid horizontal={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickFormatter={formatCompact}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="code"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <ReferenceLine x={0} stroke={GRID_STROKE} />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
        />
        <Bar dataKey="profit" name="Profit" radius={[0, 4, 4, 0]}>
          {data.map((site) => (
            // A loss is not simply a shorter bar — it points the other way and
            // means something different, so it is coloured to match.
            <Cell
              key={site.siteId}
              fill={site.profit < 0 ? 'var(--chart-5)' : 'var(--chart-3)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// TOP GAMES
// ============================================================================

export function TopGamesChart({ games }: { games: readonly DashboardTopGame[] }) {
  const height = barChartHeight(games.length);

  if (games.length === 0 || isFlat(games.map((game) => game.turnover))) {
    return (
      <ChartEmpty
        height={height}
        message="Belum ada turnover per game pada periode ini."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={[...games]}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
        barCategoryGap="25%"
      >
        <CartesianGrid horizontal={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickFormatter={formatCompact}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={92}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
        />
        <Bar
          dataKey="turnover"
          name="Turnover"
          fill="var(--chart-4)"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// SKELETON
// ============================================================================

/**
 * Placeholder with the same footprint as the chart it stands in for, so the
 * card does not resize when the data lands.
 */
export function ChartSkeleton({
  height,
  className,
}: {
  height: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-muted flex animate-pulse items-end gap-1.5 rounded-md p-3',
        className,
      )}
      style={{ height }}
      aria-hidden
    >
      {[38, 62, 45, 78, 55, 88, 40, 70, 52, 82].map((percent, index) => (
        <div
          key={index}
          className="bg-muted-foreground/15 flex-1 rounded-sm"
          style={{ height: `${percent}%` }}
        />
      ))}
    </div>
  );
}
