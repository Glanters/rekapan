'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardList, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TableImageButton } from '@/components/data-transfer/table-image-button';
import { TransferToolbar } from '@/components/data-transfer/transfer-toolbar';
import { RecordInfoPopover } from '@/components/record-info-popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

import { TurnoverEditDialog } from './turnover-edit-dialog';
import type { SiteRef, TurnoverGameDto, TurnoverRowDto } from './types';

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
    games?: TurnoverGameDto[];
    totals?: Record<string, number>;
    grandTotal?: number;
  };
}

interface TurnoverTableProps {
  sites: SiteRef[];
  canEdit: boolean;
  canImport: boolean;
  canExport: boolean;
}

const NO_GAMES: TurnoverGameDto[] = [];
const NO_ROWS: TurnoverRowDto[] = [];
const NO_TOTALS: Record<string, number> = {};

const UNGROUPED = 'Lainnya';

function money(value: number): string {
  return value.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function defaultFrom(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function TurnoverTable({
  sites,
  canEdit,
  canImport,
  canExport,
}: TurnoverTableProps) {
  const queryClient = useQueryClient();

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [siteId, setSiteId] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TurnoverRowDto | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['turnover', { from, to, siteId, page }],
    queryFn: async () => {
      const search = new URLSearchParams({
        from,
        to,
        page: String(page),
        perPage: '50',
      });
      if (siteId) search.set('siteId', siteId);

      const response = await fetch(`/api/turnover?${search.toString()}`);
      const payload = (await response.json()) as Envelope<TurnoverRowDto[]>;
      if (!payload.success) throw new Error(payload.message);
      return payload;
    },
  });

  const games = query.data?.meta.games ?? NO_GAMES;
  const totals = query.data?.meta.totals ?? NO_TOTALS;
  const grandTotal = query.data?.meta.grandTotal ?? 0;
  const rows = query.data?.data ?? NO_ROWS;

  /**
   * Rows run oldest-first, putting the newest day at the bottom of the scroll
   * area. Without this the view opens on the oldest rows in the range, which is
   * rarely what anyone came to look at. See the matching note in Monthly.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || rows.length === 0) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
  }, [rows]);
  const totalRows = query.data?.meta.total ?? 0;
  const totalPages = query.data?.meta.totalPages ?? 1;

  /**
   * Games grouped by category, preserving the order the API returned them in.
   * The grouping drives the spanned header row, so a game added to a new
   * category produces a new header group with no code change.
   */
  const groups = useMemo(() => {
    const map = new Map<string, TurnoverGameDto[]>();
    for (const game of games) {
      const key = game.category ?? UNGROUPED;
      const bucket = map.get(key);
      if (bucket) bucket.push(game);
      else map.set(key, [game]);
    }
    return [...map.entries()];
  }, [games]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Turnover</h1>
          <p className="text-muted-foreground text-sm">
            {totalRows.toLocaleString('id-ID')} laporan · {games.length} game
            {groups.length > 1 && ` · ${groups.length} kategori`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <TableImageButton
            targetRef={scrollRef}
            filename={`turnover_${from}_${to}.png`}
            disabled={rows.length === 0}
          />

          <TransferToolbar
            module="turnover"
            filters={{ from, to, siteId }}
            canImport={canImport}
            canExport={canExport}
            onImported={() =>
              void queryClient.invalidateQueries({ queryKey: ['turnover'] })
            }
          />

          {canEdit && (
            <Button onClick={() => setCreating(true)} disabled={sites.length === 0}>
              <Plus className="size-4" />
              Tambah laporan
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border/60 sticky top-14 z-20 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Dari tanggal"
          />
          <span className="text-muted-foreground text-sm">—</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Sampai tanggal"
          />
          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPage(1);
            }}
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

          {grandTotal > 0 && (
            <div className="ml-auto text-sm">
              <span className="text-muted-foreground">Total keseluruhan </span>
              <span className="font-semibold tabular-nums">{money(grandTotal)}</span>
            </div>
          )}
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
            <ClipboardList className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada laporan pada rentang ini</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Ubah rentang tanggal, atau tambahkan laporan baru.
            </p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="relative max-h-[calc(100svh-17rem)] overflow-auto"
          >
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                {/* Category band. Rendered only when categories actually differ —
                    a single band spanning every column is visual noise. */}
                {groups.length > 1 && (
                  <tr className="bg-muted/60 border-b">
                    <th
                      rowSpan={2}
                      className="bg-muted/60 text-muted-foreground sticky left-0 z-20 border-r px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      Tanggal
                    </th>
                    <th
                      rowSpan={2}
                      className="bg-muted/60 text-muted-foreground px-3 py-2 text-left font-medium"
                    >
                      Site
                    </th>
                    {groups.map(([category, categoryGames]) => (
                      <th
                        key={category}
                        colSpan={categoryGames.length}
                        className="text-muted-foreground border-l px-2.5 py-1 text-center text-[10px] font-medium tracking-wider uppercase"
                      >
                        {category}
                      </th>
                    ))}
                    <th
                      rowSpan={2}
                      className="bg-muted/60 text-muted-foreground border-l px-3 py-2 text-right font-medium"
                    >
                      Total
                    </th>
                    {/* Pinned right: with a game per column this table scrolls
                        well past the viewport, and an unpinned action column
                        is unreachable without scrolling to the far end. */}
                    <th
                      rowSpan={2}
                      data-capture-exclude
                      className="bg-muted/60 text-muted-foreground sticky right-0 z-20 w-20 border-l px-3 py-2 text-right font-medium"
                    >
                      Aksi
                    </th>
                  </tr>
                )}

                <tr className="bg-background border-b">
                  {groups.length <= 1 && (
                    <>
                      <th className="bg-background text-muted-foreground sticky left-0 z-20 border-r px-2.5 py-2 text-left font-medium whitespace-nowrap">
                        Tanggal
                      </th>
                      <th className="bg-background text-muted-foreground px-2.5 py-2 text-left font-medium">
                        Site
                      </th>
                    </>
                  )}

                  {games.map((game) => (
                    <th
                      key={game.id}
                      title={game.name}
                      className="bg-background text-muted-foreground px-2.5 py-2 text-right font-medium whitespace-nowrap"
                    >
                      {game.code}
                    </th>
                  ))}

                  {groups.length <= 1 && (
                    <>
                      <th className="bg-background text-muted-foreground border-l px-2.5 py-2 text-right font-medium">
                        Total
                      </th>
                      <th
                        data-capture-exclude
                        className="bg-background text-muted-foreground sticky right-0 z-20 w-20 border-l px-2.5 py-2 text-right font-medium"
                      >
                        Aksi
                      </th>
                    </>
                  )}
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 group border-b transition-colors"
                  >
                    <td className="bg-background group-hover:bg-muted/40 sticky left-0 z-10 border-r px-2.5 py-1.5 font-medium whitespace-nowrap">
                      {row.reportDate}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge variant="secondary" className="font-normal">
                        {row.siteCode}
                      </Badge>
                    </td>

                    {games.map((game) => {
                      const value = row.values[game.code];
                      return (
                        <td
                          key={game.id}
                          className="px-2.5 py-1.5 text-right whitespace-nowrap tabular-nums"
                        >
                          {value === undefined || value === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            money(value)
                          )}
                        </td>
                      );
                    })}

                    <td className="border-l px-2.5 py-1.5 text-right font-semibold whitespace-nowrap tabular-nums">
                      {money(row.rowTotal)}
                    </td>

                    <td
                      data-capture-exclude
                      className="bg-background group-hover:bg-muted/40 sticky right-0 z-10 border-l px-2"
                    >
                      {/* Always visible, not revealed on hover: a hover-only
                          control does not exist on touch, and hides that the
                          row is actionable. Excluded from the image capture. */}
                      <div className="flex items-center justify-end gap-0.5">
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ubah laporan ${row.reportDate}`}
                            onClick={() => setEditing(row)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        <RecordInfoPopover
                          createdAt={row.createdAt}
                          updatedAt={row.updatedAt}
                          createdBy={row.createdBy}
                          updatedBy={row.updatedBy}
                          label={row.reportDate}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="bg-muted/50 sticky bottom-0">
                <tr className="border-t-2">
                  <td className="bg-muted/50 sticky left-0 z-10 border-r px-2.5 py-2 font-medium">
                    Total
                  </td>
                  <td />
                  {games.map((game) => (
                    <td
                      key={game.id}
                      className="px-2.5 py-2 text-right font-medium whitespace-nowrap tabular-nums"
                    >
                      {money(totals[game.code] ?? 0)}
                    </td>
                  ))}
                  <td className="border-l px-2.5 py-2 text-right font-semibold whitespace-nowrap tabular-nums">
                    {money(grandTotal)}
                  </td>
                  <td
                    data-capture-exclude
                    className="bg-muted/50 sticky right-0 z-10 border-l"
                  />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Halaman {page} dari {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="size-4" />
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Berikutnya
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <TurnoverEditDialog
        open={creating || editing !== null}
        row={editing}
        games={games}
        sites={sites}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['turnover'] });
        }}
      />
    </div>
  );
}
