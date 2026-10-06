'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SiteTrendMetric, SiteTrendResult } from '@/server/site-trend/service';

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

const SHOWN_SITES = 3;
const SHOWN_METRICS = 3;

const isFall = (m: SiteTrendMetric) =>
  m.change.significant &&
  (m.change.direction === 'down' || m.change.direction === 'gone');
const isRise = (m: SiteTrendMetric) =>
  m.change.significant && (m.change.direction === 'up' || m.change.direction === 'new');

function shortChange(metric: SiteTrendMetric): string {
  if (metric.change.direction === 'gone') return 'hilang';
  if (metric.change.ratio === null) return '';
  return `${Math.round(metric.change.ratio * 100)}%`;
}

/**
 * The month-to-date headline from Naik Turun Site: how many sites fell, and
 * the few that fell in the most places, each naming where. Always the current
 * month across every site the user can see — the Dashboard's own range and
 * site filter do not apply — so the title says so.
 */
export function SiteTrendCard() {
  const query = useQuery({
    queryKey: ['site-trend', 'dashboard'],
    queryFn: async () => {
      const response = await fetch('/api/site-trend');
      const payload = (await response.json()) as Envelope<SiteTrendResult>;
      if (!payload.success) throw new Error(payload.message);
      return payload.data as SiteTrendResult;
    },
  });

  // A card that failed to load is not worth an error on the Dashboard; the
  // full page reports it.
  if (query.isError) return null;

  const sites = (query.data?.sites ?? [])
    .map((site) => ({
      site,
      falls: site.metrics
        .filter(isFall)
        .sort((a, b) => (a.change.ratio ?? -Infinity) - (b.change.ratio ?? -Infinity)),
    }))
    .filter((row) => row.falls.length > 0)
    .sort((a, b) => b.falls.length - a.falls.length);
  const rising = (query.data?.sites ?? []).filter((s) => s.metrics.some(isRise)).length;

  return (
    <Card className="ring-foreground/10">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Naik Turun Site</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            Bulan ini dibanding hari yang sama bulan lalu, semua site Anda.
          </p>
        </div>
        <Link
          href="/site-trend"
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-sm font-medium"
        >
          Lihat semua
          <ArrowRight className="size-4" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading || !query.data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <ArrowDown className="size-4 text-red-600 dark:text-red-400" />
                <span className="font-semibold tabular-nums">{sites.length}</span>
                <span className="text-muted-foreground">site ada yang turun</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ArrowUp className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold tabular-nums">{rising}</span>
                <span className="text-muted-foreground">site ada yang naik</span>
              </span>
            </div>

            {sites.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Tidak ada site yang turun 10% atau lebih bulan ini.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sites.slice(0, SHOWN_SITES).map(({ site, falls }) => (
                  <li
                    key={site.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="w-28 shrink-0 truncate text-sm font-semibold">
                      {site.name}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs">
                      {falls.slice(0, SHOWN_METRICS).map((metric) => (
                        <span key={metric.id} className="whitespace-nowrap">
                          {metric.label}{' '}
                          <span
                            className={cn(
                              'font-semibold tabular-nums',
                              metric.change.favourable === false
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-emerald-700 dark:text-emerald-400',
                            )}
                          >
                            {shortChange(metric)}
                          </span>
                        </span>
                      ))}
                      {falls.length > SHOWN_METRICS && (
                        <span className="text-muted-foreground">
                          +{falls.length - SHOWN_METRICS} lainnya
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
