'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  TrendingUpDown,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  MetricKind,
  SiteTrendMetric,
  SiteTrendResult,
  SiteTrendSite,
} from '@/server/site-trend/service';

import { DailyPanel } from './daily-panel';

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

type Focus = 'all' | 'down' | 'up';

const FOCUS_ITEMS: { key: Focus; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'down', label: 'Turun' },
  { key: 'up', label: 'Naik' },
];

const KIND_LABELS: Record<MetricKind, string> = {
  monthly: 'Monthly',
  turnover: 'Turnover',
  completeness: 'Kelengkapan',
};
const KINDS = Object.keys(KIND_LABELS) as MetricKind[];

const MONTHS_SHORT = [
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

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year ?? 1970, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `{from: 2026-10-01, to: 2026-10-06}` → `1–6 Okt 2026`. */
function formatWindow(window: { from: string; to: string }): string {
  const [year, month, fromDay] = window.from.split('-').map(Number);
  const toDay = Number(window.to.slice(8, 10));
  const span = fromDay === toDay ? `${fromDay}` : `${fromDay}–${toDay}`;
  return `${span} ${MONTHS_SHORT[(month ?? 1) - 1]} ${year}`;
}

/** Compact for scanning (`12,4 jt`), exact in the tooltip. */
function formatCompact(value: number, digits: number): string {
  if (Math.abs(value) < 10_000) {
    return value.toLocaleString('id-ID', { maximumFractionDigits: digits });
  }
  return value.toLocaleString('id-ID', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

function formatExact(value: number, digits: number): string {
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatChange(metric: SiteTrendMetric): string {
  const { change } = metric;
  if (change.direction === 'new') return 'baru';
  if (change.direction === 'gone') return 'hilang';
  if (change.ratio === null) return '—';
  const pct = change.ratio * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(pct) < 10 ? 1 : 0 })}%`;
}

const isRise = (m: SiteTrendMetric) =>
  m.change.significant && (m.change.direction === 'up' || m.change.direction === 'new');
const isFall = (m: SiteTrendMetric) =>
  m.change.significant &&
  (m.change.direction === 'down' || m.change.direction === 'gone');

/** Biggest move first; a vanished or new figure outranks any percentage. */
function byMagnitude(a: SiteTrendMetric, b: SiteTrendMetric): number {
  const size = (m: SiteTrendMetric) =>
    m.change.ratio === null ? Infinity : Math.abs(m.change.ratio);
  return size(b) - size(a);
}

export function SiteTrendClient() {
  const [month, setMonth] = useState(currentMonth);
  const [focus, setFocus] = useState<Focus>('all');
  const [kinds, setKinds] = useState<Set<MetricKind>>(() => new Set(KINDS));

  const query = useQuery({
    queryKey: ['site-trend', month],
    queryFn: async () => {
      const response = await fetch(`/api/site-trend?month=${month}`);
      const payload = (await response.json()) as Envelope<SiteTrendResult>;
      if (!payload.success) throw new Error(payload.message);
      return payload.data as SiteTrendResult;
    },
  });

  const data = query.data;
  const availableKinds = useMemo(
    () =>
      KINDS.filter((kind) =>
        data?.sites.some((site) => site.metrics.some((m) => m.kind === kind)),
      ),
    [data],
  );

  // Each site, reduced to the metrics the filters keep, then ordered by what
  // the view is about: most falls (or rises) first, or most bad news overall.
  const sites = useMemo(() => {
    if (!data) return [];
    return data.sites
      .map((site) => {
        const metrics = site.metrics.filter((m) => kinds.has(m.kind));
        return {
          site,
          metrics,
          falls: metrics.filter(isFall).sort(byMagnitude),
          rises: metrics.filter(isRise).sort(byMagnitude),
          worse: metrics.filter((m) => m.change.favourable === false).length,
        };
      })
      .filter((row) =>
        focus === 'down'
          ? row.falls.length > 0
          : focus === 'up'
            ? row.rises.length > 0
            : true,
      )
      .sort(
        (a, b) =>
          (focus === 'down'
            ? b.falls.length - a.falls.length
            : focus === 'up'
              ? b.rises.length - a.rises.length
              : b.worse - a.worse || b.falls.length - a.falls.length) ||
          a.site.name.localeCompare(b.site.name),
      );
  }, [data, kinds, focus]);

  const summary = useMemo(() => {
    const rows = data?.sites ?? [];
    let falling = 0;
    let rising = 0;
    let steady = 0;
    for (const site of rows) {
      const metrics = site.metrics.filter((m) => kinds.has(m.kind));
      const f = metrics.some(isFall);
      const r = metrics.some(isRise);
      if (f) falling += 1;
      if (r) rising += 1;
      if (!f && !r) steady += 1;
    }
    return { falling, rising, steady };
  }, [data, kinds]);

  const toggleKind = (kind: MetricKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind) && next.size > 1) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Naik Turun Site</h1>
        <p className="text-muted-foreground text-sm">
          Setiap site dibandingkan dengan hari yang sama di bulan sebelumnya. Perubahan
          di bawah 10% dianggap stabil.
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
              max={currentMonth()}
              onChange={(event) => setMonth(event.target.value || currentMonth())}
              className="w-auto"
              aria-label="Bulan"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Bulan berikutnya"
              disabled={month >= currentMonth()}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <ChevronRight />
            </Button>
          </div>

          <Segmented label="Tampilkan">
            {FOCUS_ITEMS.map((item) => (
              <SegmentButton
                key={item.key}
                active={focus === item.key}
                onClick={() => setFocus(item.key)}
              >
                {item.label}
              </SegmentButton>
            ))}
          </Segmented>

          {availableKinds.length > 1 && (
            <div role="group" aria-label="Bagian" className="flex flex-wrap gap-1.5">
              {availableKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={kinds.has(kind)}
                  onClick={() => toggleKind(kind)}
                  className={cn(
                    'focus-visible:ring-ring/50 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3',
                    kinds.has(kind)
                      ? 'border-foreground/20 bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          )}

          {data && (
            <p className="text-muted-foreground ml-auto text-xs">
              <span className="text-foreground font-medium">
                {formatWindow(data.current)}
              </span>{' '}
              dibanding {formatWindow(data.previous)}
              {!data.sameLength && ' · dihitung per hari'}
            </p>
          )}
        </div>
      </Card>

      {query.isError && (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>Data gagal dimuat</AlertTitle>
          <AlertDescription>{(query.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {query.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : data && data.sites.length === 0 ? (
        <Card className="border-border/60 flex flex-col items-center gap-2 py-16 text-center">
          <TrendingUpDown className="text-muted-foreground size-8" />
          <p className="font-medium">Belum ada site pada cakupan ini</p>
        </Card>
      ) : data ? (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <SummaryPill
              tone="down"
              count={summary.falling}
              label="site ada yang turun"
            />
            <SummaryPill tone="up" count={summary.rising} label="site ada yang naik" />
            <SummaryPill tone="flat" count={summary.steady} label="site stabil" />
          </div>

          {sites.length === 0 ? (
            <Card className="border-border/60 text-muted-foreground py-12 text-center text-sm">
              {focus === 'down'
                ? 'Tidak ada site yang turun pada bagian yang dipilih.'
                : 'Tidak ada site yang naik pada bagian yang dipilih.'}
            </Card>
          ) : (
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {sites.map((row) => (
                <SiteCard
                  key={row.site.id}
                  month={month}
                  site={row.site}
                  metrics={row.metrics}
                  falls={focus === 'up' ? [] : row.falls}
                  rises={focus === 'down' ? [] : row.rises}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

type DetailTab = 'summary' | 'daily';

function SiteCard({
  month,
  site,
  metrics,
  falls,
  rises,
}: {
  month: string;
  site: SiteTrendSite;
  metrics: SiteTrendMetric[];
  falls: SiteTrendMetric[];
  rises: SiteTrendMetric[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>('daily');
  // Defaults to the biggest bad move — the thing someone opening a site most
  // likely wants to trace back to the day it started.
  const [dailyMetric, setDailyMetric] = useState<string | null>(null);
  const steady = falls.length === 0 && rises.length === 0;

  const showDaily = (metricId: string) => {
    setDailyMetric(metricId);
    setTab('daily');
    setOpen(true);
  };
  const defaultMetric =
    [...falls, ...rises].find((m) => m.change.favourable === false)?.id ??
    falls[0]?.id ??
    rises[0]?.id ??
    metrics[0]?.id ??
    null;

  return (
    <Card className="border-border/60 gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{site.name}</p>
          <p className="text-muted-foreground font-mono text-xs">{site.code}</p>
        </div>
        {falls.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
            <ArrowDown className="size-3" />
            {falls.length} turun
          </span>
        )}
        {rises.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <ArrowUp className="size-3" />
            {rises.length} naik
          </span>
        )}
      </div>

      {steady ? (
        <p className="text-muted-foreground px-4 py-4 text-sm">
          Semua bagian stabil (perubahan di bawah 10%).
        </p>
      ) : (
        <div className="divide-y">
          {falls.length > 0 && (
            <MetricList title="Turun" metrics={falls} onPick={showDaily} />
          )}
          {rises.length > 0 && (
            <MetricList title="Naik" metrics={rises} onPick={showDaily} />
          )}
        </div>
      )}

      {metrics.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full items-center justify-between px-4 py-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-inset"
          >
            {open ? 'Sembunyikan rincian' : `Rincian semua bagian & harian`}
            <ChevronDown
              className={cn('size-4 transition-transform', open && 'rotate-180')}
            />
          </button>
          {open && (
            <div className="space-y-2 pb-3">
              <div className="px-4">
                <Segmented label="Rincian">
                  <SegmentButton
                    active={tab === 'daily'}
                    onClick={() => setTab('daily')}
                  >
                    Harian
                  </SegmentButton>
                  <SegmentButton
                    active={tab === 'summary'}
                    onClick={() => setTab('summary')}
                  >
                    Semua bagian ({metrics.length})
                  </SegmentButton>
                </Segmented>
              </div>
              {tab === 'summary' ? (
                <MetricTable metrics={metrics} onPick={showDaily} />
              ) : (
                <DailyPanel
                  siteId={site.id}
                  month={month}
                  metricId={dailyMetric ?? defaultMetric}
                  onMetric={setDailyMetric}
                />
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function MetricList({
  title,
  metrics,
  onPick,
}: {
  title: string;
  metrics: SiteTrendMetric[];
  onPick: (metricId: string) => void;
}) {
  return (
    <div className="px-4 py-2.5">
      <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </p>
      <ul className="space-y-1.5">
        {metrics.map((metric) => (
          <li key={metric.id} className="flex items-baseline gap-2 text-sm">
            <ChangeBadge metric={metric} />
            <span className="min-w-0 flex-1 truncate">
              <button
                type="button"
                onClick={() => onPick(metric.id)}
                className="focus-visible:ring-ring/50 rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3"
              >
                {metric.label}
              </button>
              {metric.group && (
                <span className="text-muted-foreground ml-1.5 text-xs">
                  {metric.group}
                </span>
              )}
            </span>
            <span
              className="text-muted-foreground shrink-0 text-xs tabular-nums"
              title={`${formatExact(metric.previous, metric.digits)} → ${formatExact(metric.current, metric.digits)}`}
            >
              {formatCompact(metric.previous, metric.digits)} →{' '}
              <span className="text-foreground font-medium">
                {formatCompact(metric.current, metric.digits)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricTable({
  metrics,
  onPick,
}: {
  metrics: SiteTrendMetric[];
  onPick: (metricId: string) => void;
}) {
  return (
    <div className="overflow-x-auto px-4 pb-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 font-medium">Bagian</th>
            <th className="py-1 text-right font-medium">Bulan lalu</th>
            <th className="py-1 text-right font-medium">Bulan ini</th>
            <th className="py-1 text-right font-medium">Perubahan</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.id} className="border-t align-top">
              <td className="py-1.5 pr-2">
                <button
                  type="button"
                  onClick={() => onPick(metric.id)}
                  className="focus-visible:ring-ring/50 block rounded-sm text-left font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3"
                >
                  {metric.label}
                </button>
                <span className="text-muted-foreground block">
                  {metric.group ?? KIND_LABELS[metric.kind]}
                </span>
              </td>
              {[metric.previous, metric.current].map((value, i) => (
                <td
                  key={i}
                  className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums"
                  title={formatExact(value, metric.digits)}
                >
                  {/* Compact on phones, where two full rupiah figures side by
                      side cannot fit; exact from sm up and in the tooltip. */}
                  <span className="sm:hidden">
                    {formatCompact(value, metric.digits)}
                  </span>
                  <span className="hidden sm:inline">
                    {formatExact(value, metric.digits)}
                  </span>
                </td>
              ))}
              <td className="py-1.5 pl-2 text-right">
                <ChangeBadge metric={metric} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The arrow shows which way the figure moved; the colour says whether that is
 * good news — so a withdraw that rose reads as an up arrow in red.
 */
function ChangeBadge({ metric }: { metric: SiteTrendMetric }) {
  const { change } = metric;
  const rose = change.direction === 'up' || change.direction === 'new';
  const fell = change.direction === 'down' || change.direction === 'gone';
  const Arrow = rose ? ArrowUp : fell ? ArrowDown : null;
  return (
    <span
      className={cn(
        'inline-flex w-16 shrink-0 items-center justify-end gap-0.5 text-xs font-semibold tabular-nums',
        change.favourable === true && 'text-emerald-700 dark:text-emerald-400',
        change.favourable === false && 'text-red-700 dark:text-red-400',
        change.favourable === null && 'text-muted-foreground font-normal',
      )}
    >
      {Arrow && <Arrow className="size-3" />}
      {formatChange(metric)}
    </span>
  );
}

function SummaryPill({
  tone,
  count,
  label,
}: {
  tone: 'up' | 'down' | 'flat';
  count: number;
  label: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-md border px-3 py-1.5',
        tone === 'down' && 'border-red-500/20 bg-red-500/5',
        tone === 'up' && 'border-emerald-500/20 bg-emerald-500/5',
        tone === 'flat' && 'border-border bg-muted/40',
      )}
    >
      <span
        className={cn(
          'text-base font-semibold tabular-nums',
          tone === 'down' && 'text-red-700 dark:text-red-400',
          tone === 'up' && 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {count}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Segmented({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="border-border/60 bg-muted/40 inline-flex rounded-md border p-0.5"
    >
      {children}
    </div>
  );
}

function SegmentButton({
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
