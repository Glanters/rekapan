'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import {
  Activity,
  ArrowDownRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CircleAlert,
  Coins,
  Gamepad2,
  Loader2,
  Minus,
  RotateCcw,
  Table2,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  CASHFLOW_HEIGHT,
  CASHFLOW_LEGEND,
  CashflowChart,
  ChartLegend,
  ChartSkeleton,
  ProfitBySiteChart,
  TURNOVER_HEIGHT,
  TURNOVER_LEGEND,
  TopGamesChart,
  TurnoverTrendChart,
  barChartHeight,
} from './dashboard-charts';
import { computeDelta, formatLongDate, formatNumber, formatRupiah } from './format';
import type {
  DashboardActivity,
  DashboardData,
  DashboardTotals,
  Envelope,
  SiteRef,
} from './types';

/**
 * The dashboard.
 *
 * One query backs the whole page. Every widget reads from the same payload, so
 * the cards, the charts, and the table can never describe different periods —
 * which is exactly what happens when each widget fetches its own slice and one
 * of them is a little slower than the rest.
 *
 * Nothing is aggregated here. The client receives figures that Postgres already
 * summed and its only arithmetic is the period-over-period percentage, which
 * operates on two numbers rather than two datasets.
 */

const ALL_SITES = '__all__';

// ============================================================================
// RANGE PRESETS
// ============================================================================

interface Range {
  from: string;
  to: string;
}

/**
 * Today in the viewer's own timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that is UTC, and for a user in
 * WIB every filter set between midnight and 07:00 would silently ask for
 * yesterday.
 */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

const PRESETS = [
  { key: 'today', label: 'Hari ini' },
  { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' },
  { key: 'month', label: 'Bulan ini' },
] as const;

type PresetKey = (typeof PRESETS)[number]['key'];

function presetRange(key: PresetKey): Range {
  const to = todayIso();
  switch (key) {
    case 'today':
      return { from: to, to };
    case '7d':
      return { from: addDays(to, -6), to };
    case '30d':
      return { from: addDays(to, -29), to };
    case 'month':
      return { from: `${to.slice(0, 7)}-01`, to };
  }
}

function matchingPreset(range: Range): PresetKey | null {
  return (
    PRESETS.find((preset) => {
      const candidate = presetRange(preset.key);
      return candidate.from === range.from && candidate.to === range.to;
    })?.key ?? null
  );
}

// ============================================================================
// STAT CARDS
// ============================================================================

interface StatCardDef {
  key: keyof DashboardTotals;
  label: string;
  icon: typeof Coins;
  /** Set when a rise is the unwelcome direction, so the delta colours invert. */
  invert?: boolean;
  hint?: string;
  /** A plain count (bets, members) rather than a rupiah amount — no "Rp". */
  count?: boolean;
}

const STAT_CARDS: readonly StatCardDef[] = [
  { key: 'deposit', label: 'Deposit', icon: ArrowDownToLine },
  { key: 'withdraw', label: 'Withdraw', icon: ArrowUpFromLine, invert: true },
  { key: 'profit', label: 'Profit', icon: TrendingUp, hint: 'Deposit − withdraw' },
  { key: 'turnover', label: 'Turnover', icon: Coins },
  { key: 'bet', label: 'Total Bet', icon: Gamepad2, count: true },
  { key: 'validasi', label: 'Validasi', icon: BadgeCheck, count: true },
];

function StatCard({
  definition,
  value,
  previous,
}: {
  definition: StatCardDef;
  value: number;
  previous: number;
}) {
  const delta = computeDelta(value, previous);
  // A rise in withdraw is not the same news as a rise in deposit, so the tone
  // follows the metric rather than the sign.
  const favourable = delta
    ? definition.invert
      ? delta.ratio < 0
      : delta.ratio > 0
    : false;
  const DeltaIcon =
    delta?.direction === 'up'
      ? ArrowUpRight
      : delta?.direction === 'down'
        ? ArrowDownRight
        : Minus;

  return (
    <Card className="ring-foreground/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {definition.label}
        </CardTitle>
        <definition.icon className="text-muted-foreground size-4" aria-hidden />
      </CardHeader>
      <CardContent className="space-y-1">
        <p
          className={cn(
            'text-2xl font-semibold tracking-tight tabular-nums',
            value < 0 && 'text-destructive',
          )}
        >
          {definition.count ? formatNumber(value) : formatRupiah(value)}
        </p>
        <div className="flex items-center gap-1.5 text-xs">
          {delta ? (
            <>
              <span
                className={cn(
                  'flex items-center gap-0.5 font-medium',
                  delta.direction === 'flat'
                    ? 'text-muted-foreground'
                    : favourable
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-destructive',
                )}
              >
                <DeltaIcon className="size-3" aria-hidden />
                {delta.label}
              </span>
              <span className="text-muted-foreground">vs periode sebelumnya</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {definition.hint ?? 'Tidak ada pembanding'}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card className="ring-foreground/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="size-4 rounded-full" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// RECENT ACTIVITY
// ============================================================================

/**
 * Audit actions read as `module.verb`. Translating the verb keeps the feed in
 * Indonesian without needing an entry per action — and an unknown verb falls
 * back to the raw key rather than disappearing.
 */
const ACTION_VERBS: Record<string, string> = {
  created: 'menambahkan',
  updated: 'memperbarui',
  deleted: 'menghapus',
  approved: 'menyetujui',
  locked: 'mengunci',
  activated: 'mengaktifkan',
  suspended: 'menangguhkan',
  reinstated: 'memulihkan',
  imported: 'mengimpor',
  exported: 'mengekspor',
  uploaded: 'mengunggah',
  downloaded: 'mengunduh',
  assigned: 'menugaskan',
  login: 'masuk ke sistem',
  logout: 'keluar dari sistem',
};

function describeAction(entry: DashboardActivity): string {
  const verb = ACTION_VERBS[entry.action.split('.').at(-1) ?? ''];
  if (!verb) return entry.action;
  if (verb.startsWith('masuk') || verb.startsWith('keluar')) return verb;
  return `${verb} ${entry.module}`;
}

function RecentActivity({ entries }: { entries: readonly DashboardActivity[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Activity className="size-6 opacity-40" aria-hidden />
        <p className="max-w-[30ch] text-xs">
          Belum ada aktivitas tercatat pada periode ini.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-border/60 divide-y">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <Badge variant="secondary" className="mt-0.5 shrink-0 font-normal">
            {entry.module}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <span className="font-medium">{entry.actorEmail ?? 'Sistem'}</span>{' '}
              <span className="text-muted-foreground">{describeAction(entry)}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {formatDistanceToNow(new Date(entry.createdAt), {
                addSuffix: true,
                locale: idLocale,
              })}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3">
          <Skeleton className="h-5 w-16 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// PAGE
// ============================================================================

export interface DashboardClientProps {
  sites: SiteRef[];
  firstName: string;
  /** An active account with no site reaches no data at all; say so explicitly. */
  hasNoSites: boolean;
}

async function fetchDashboard(siteId: string, range: Range): Promise<DashboardData> {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (siteId !== ALL_SITES) params.set('siteId', siteId);

  const response = await fetch(`/api/dashboard?${params.toString()}`);
  const payload = (await response.json()) as Envelope<DashboardData>;
  if (!payload.success || !payload.data) {
    throw new Error(payload.message || 'Dashboard gagal dimuat.');
  }
  return payload.data;
}

export function DashboardClient({
  sites,
  firstName,
  hasNoSites,
}: DashboardClientProps) {
  const [range, setRange] = useState<Range>(() => presetRange('30d'));
  const [siteId, setSiteId] = useState<string>(ALL_SITES);

  const query = useQuery({
    queryKey: ['dashboard', siteId, range.from, range.to],
    queryFn: () => fetchDashboard(siteId, range),
    // Keeps the previous period on screen while the next one loads, so changing
    // a filter dims the page rather than emptying it.
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const isLoading = query.isPending;
  const activePreset = useMemo(() => matchingPreset(range), [range]);

  const siteItems = useMemo(
    () => [
      { value: ALL_SITES, label: 'Semua site' },
      ...sites.map((site) => ({
        value: site.id,
        label: `${site.code} — ${site.name}`,
      })),
    ],
    [sites],
  );

  // Three distinct "there is nothing here" situations, which need three
  // different messages: no site assigned, nothing ever entered, and nothing in
  // the chosen window. Collapsing them into one empty state is what makes an
  // empty dashboard read as a broken one.
  const hasAnyData = data
    ? data.coverage.hasAnyMonthly || data.coverage.hasAnyTurnover
    : true;
  const hasDataInRange = data
    ? data.coverage.monthlyReports > 0 || data.coverage.turnoverReports > 0
    : true;

  function applyPreset(key: PresetKey) {
    setRange(presetRange(key));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Selamat datang kembali, {firstName}.
            {data && (
              <>
                {' '}
                Periode {formatLongDate(data.range.from)} –{' '}
                {formatLongDate(data.range.to)}.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {query.isFetching && !isLoading && (
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Memuat…
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RotateCcw className="size-4" aria-hidden />
            Perbarui
          </Button>
        </div>
      </div>

      {hasNoSites && (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>Belum ada site yang ditugaskan</AlertTitle>
          <AlertDescription>
            Akun Anda aktif, tetapi belum memiliki akses ke site mana pun — sehingga
            belum ada data yang dapat ditampilkan. Hubungi administrator untuk
            ditugaskan ke sebuah site.
          </AlertDescription>
        </Alert>
      )}

      {/* -- Filter bar -------------------------------------------------- */}
      <Card className="ring-foreground/10">
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1 space-y-1.5 sm:max-w-64">
              <Label htmlFor="dashboard-site" className="text-xs">
                Site
              </Label>
              <Select
                items={siteItems}
                value={siteId}
                onValueChange={(value) =>
                  setSiteId(typeof value === 'string' ? value : ALL_SITES)
                }
              >
                <SelectTrigger id="dashboard-site" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {siteItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dashboard-from" className="text-xs">
                Dari tanggal
              </Label>
              <Input
                id="dashboard-from"
                type="date"
                value={range.from}
                max={range.to}
                onChange={(event) =>
                  setRange((prev) => ({
                    ...prev,
                    from: event.target.value || prev.from,
                  }))
                }
                className="w-40"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dashboard-to" className="text-xs">
                Sampai tanggal
              </Label>
              <Input
                id="dashboard-to"
                type="date"
                value={range.to}
                min={range.from}
                onChange={(event) =>
                  setRange((prev) => ({ ...prev, to: event.target.value || prev.to }))
                }
                className="w-40"
              />
            </div>

            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Periode cepat"
            >
              {PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  size="sm"
                  variant={activePreset === preset.key ? 'secondary' : 'outline'}
                  aria-pressed={activePreset === preset.key}
                  onClick={() => applyPreset(preset.key)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {query.isError && (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>Dashboard gagal dimuat</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : 'Terjadi kesalahan.'}
          </AlertDescription>
        </Alert>
      )}

      {/* -- Stat cards -------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading || !data
          ? STAT_CARDS.map((definition) => <StatCardSkeleton key={definition.key} />)
          : STAT_CARDS.map((definition) => (
              <StatCard
                key={definition.key}
                definition={definition}
                value={data.totals[definition.key]}
                previous={data.previousTotals[definition.key]}
              />
            ))}
      </div>

      {!isLoading && data && !hasAnyData && !hasNoSites ? (
        <Card className="border-dashed ring-0">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Table2 className="text-muted-foreground size-8" aria-hidden />
            <p className="font-medium">Belum ada data laporan</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Grafik dan ringkasan akan terisi setelah laporan Monthly atau Turnover
              pertama dimasukkan. Semua angka di atas masih nol karena belum ada yang
              tercatat.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {!isLoading && data && !hasDataInRange && (
            <Alert>
              <CircleAlert className="size-4" />
              <AlertTitle>Tidak ada laporan pada periode ini</AlertTitle>
              <AlertDescription>
                Data tersedia di periode lain. Coba perlebar rentang tanggal — misalnya
                30 hari terakhir — atau pilih site yang berbeda.
              </AlertDescription>
            </Alert>
          )}

          {/* -- Trend charts ---------------------------------------------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="ring-foreground/10 lg:col-span-2">
              <CardHeader>
                <CardTitle>Deposit vs Withdraw</CardTitle>
                <CardDescription>
                  Arus harian sepanjang periode terpilih.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading || !data ? (
                  <ChartSkeleton height={CASHFLOW_HEIGHT} />
                ) : (
                  <>
                    <CashflowChart series={data.series} />
                    <ChartLegend entries={CASHFLOW_LEGEND} />
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="ring-foreground/10">
              <CardHeader>
                <CardTitle>Tren Turnover</CardTitle>
                <CardDescription>Turnover harian.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading || !data ? (
                  <ChartSkeleton height={TURNOVER_HEIGHT} />
                ) : (
                  <>
                    <TurnoverTrendChart series={data.series} />
                    <ChartLegend entries={TURNOVER_LEGEND} />
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* -- Breakdown ------------------------------------------------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="ring-foreground/10">
              <CardHeader>
                <CardTitle>Profit per Site</CardTitle>
                <CardDescription>Deposit dikurangi withdraw.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ChartSkeleton height={barChartHeight(4)} />
                ) : (
                  <ProfitBySiteChart sites={data.bySite} />
                )}
              </CardContent>
            </Card>

            <Card className="ring-foreground/10">
              <CardHeader>
                <CardTitle>Game Teratas</CardTitle>
                <CardDescription>Turnover tertinggi pada periode ini.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ChartSkeleton height={barChartHeight(6)} />
                ) : (
                  <TopGamesChart games={data.topGames} />
                )}
              </CardContent>
            </Card>

            <Card className="ring-foreground/10">
              <CardHeader>
                <CardTitle>Aktivitas Terbaru</CardTitle>
                <CardDescription>
                  Catatan audit terakhir yang dapat Anda lihat.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ActivitySkeleton />
                ) : (
                  <RecentActivity entries={data.activity} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* -- Per-site table -------------------------------------------- */}
          {!isLoading && data && data.bySite.length > 0 && (
            <Card className="ring-foreground/10">
              <CardHeader>
                <CardTitle>Ringkasan per Site</CardTitle>
                <CardDescription>
                  Turnover dan profit setiap site pada periode terpilih.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-border/60 border-b text-left">
                        <th className="py-2 pr-4 font-medium">Site</th>
                        <th className="py-2 pr-4 text-right font-medium">Turnover</th>
                        <th className="py-2 text-right font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bySite.map((site) => (
                        <tr
                          key={site.siteId}
                          className="border-border/60 border-b last:border-0"
                        >
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              <Building2
                                className="text-muted-foreground size-3.5"
                                aria-hidden
                              />
                              <span className="font-medium">{site.code}</span>
                              <span className="text-muted-foreground truncate">
                                {site.name}
                              </span>
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatRupiah(site.turnover)}
                          </td>
                          <td
                            className={cn(
                              'py-2 text-right font-medium tabular-nums',
                              site.profit < 0 && 'text-destructive',
                            )}
                          >
                            {formatRupiah(site.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
