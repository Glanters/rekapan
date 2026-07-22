'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Pencil,
  Plus,
  Table2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TableImageButton } from '@/components/data-transfer/table-image-button';
import { TransferToolbar } from '@/components/data-transfer/transfer-toolbar';
import { RecordInfoPopover } from '@/components/record-info-popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { MonthlyEditDialog } from './monthly-edit-dialog';
import type {
  BankDto,
  CellValue,
  MonthlyColumnDto,
  MonthlyRowDto,
  SiteRef,
} from './types';

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
    columns?: MonthlyColumnDto[];
    banks?: BankDto[];
    totals?: Record<string, number>;
  };
}

interface MonthlyTableProps {
  sites: SiteRef[];
  canEdit: boolean;
  canImport: boolean;
  canExport: boolean;
}

/** First day of the current month, in the ISO form the API expects. */
function defaultFrom(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatCell(value: CellValue, column: MonthlyColumnDto): string {
  if (value === null || value === '') return '—';

  switch (column.dataType) {
    case 'TEXT':
    case 'DATE':
      return String(value);
    case 'BOOLEAN':
      return value ? 'Ya' : 'Tidak';
    case 'PERCENT':
      return `${Number(value).toLocaleString('id-ID', {
        minimumFractionDigits: column.precision,
        maximumFractionDigits: column.precision,
      })}%`;
    default:
      return Number(value).toLocaleString('id-ID', {
        minimumFractionDigits: column.precision,
        maximumFractionDigits: column.precision,
      });
  }
}

const NUMERIC_TYPES = new Set(['CURRENCY', 'DECIMAL', 'INTEGER', 'PERCENT']);

/**
 * Stable fallbacks. A `?? []` literal allocates a fresh array on every render,
 * which changes the identity every dependency array compares against — the
 * column definitions would then be rebuilt on each render despite the useMemo.
 */
const NO_COLUMNS: MonthlyColumnDto[] = [];
const NO_BANKS: BankDto[] = [];
const NO_ROWS: MonthlyRowDto[] = [];
const NO_TOTALS: Record<string, number> = {};

export function MonthlyTable({
  sites,
  canEdit,
  canImport,
  canExport,
}: MonthlyTableProps) {
  const queryClient = useQueryClient();

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [siteId, setSiteId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [editing, setEditing] = useState<MonthlyRowDto | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['monthly', { from, to, siteId, page }],
    queryFn: async () => {
      const search = new URLSearchParams({
        from,
        to,
        page: String(page),
        perPage: '50',
      });
      if (siteId) search.set('siteId', siteId);

      const response = await fetch(`/api/monthly?${search.toString()}`);
      const payload = (await response.json()) as Envelope<MonthlyRowDto[]>;
      if (!payload.success) throw new Error(payload.message);
      return payload;
    },
  });

  /**
   * Rows run oldest-first, so the newest day is at the bottom of the scroll
   * area — out of sight on open. Landing on last month's figures when you asked
   * for this month is worse than the ordering it came from, so the view starts
   * where the data ends.
   *
   * `auto` rather than `smooth`: this fires on load and on every filter change,
   * and an animated jump each time reads as the table lurching.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dynamicColumns = query.data?.meta.columns ?? NO_COLUMNS;
  const banks = query.data?.meta.banks ?? NO_BANKS;
  const totals = query.data?.meta.totals ?? NO_TOTALS;
  const rows = query.data?.data ?? NO_ROWS;
  const totalRows = query.data?.meta.total ?? 0;
  const totalPages = query.data?.meta.totalPages ?? 1;

  /**
   * Column definitions are derived from the API response, not hard-coded.
   * Adding a row to `monthly_columns` therefore adds a column here with no code
   * change — which is the entire reason the data is stored as EAV.
   */
  const columns = useMemo<ColumnDef<MonthlyRowDto>[]>(() => {
    const base: ColumnDef<MonthlyRowDto>[] = [
      {
        id: 'reportDate',
        header: 'Tanggal',
        accessorFn: (row) => row.reportDate,
        size: 96,
      },
      {
        id: 'site',
        header: 'Site',
        accessorFn: (row) => row.siteCode,
        size: 64,
      },
    ];

    // A minimum rather than a fixed width: cells are nowrap, so a long label or
    // a large figure still pushes its column out instead of being clipped.
    const dynamic: ColumnDef<MonthlyRowDto>[] = dynamicColumns.map((column) => ({
      id: column.key,
      header: column.label,
      accessorFn: (row) => row.values[column.key] ?? null,
      size: 112,
      minSize: 80,
      meta: { column },
    }));

    return [...base, ...dynamic];
  }, [dynamicColumns]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || rows.length === 0) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
  }, [rows]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Monthly</h1>
          <p className="text-muted-foreground text-sm">
            {totalRows.toLocaleString('id-ID')} laporan · {dynamicColumns.length} kolom
          </p>
        </div>

        <div className="flex items-center gap-2">
          <TableImageButton
            targetRef={scrollRef}
            filename={`monthly_${from}_${to}.png`}
            disabled={rows.length === 0}
          />

          <TransferToolbar
            module="monthly"
            filters={{ from, to, siteId }}
            canImport={canImport}
            canExport={canExport}
            onImported={() =>
              void queryClient.invalidateQueries({ queryKey: ['monthly'] })
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

      {/* Sticky toolbar: filters stay reachable while a wide table is scrolled. */}
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

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Columns3 className="size-4" />
                Kolom
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-80 w-56 overflow-y-auto"
              >
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  Tampilkan kolom
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.id !== 'reportDate')
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                    >
                      {typeof column.columnDef.header === 'string'
                        ? column.columnDef.header
                        : column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
            <Table2 className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada laporan pada rentang ini</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Ubah rentang tanggal, atau tambahkan laporan baru.
            </p>
          </div>
        ) : (
          // The wrapper owns the scroll so sticky offsets resolve against it
          // rather than the page, which is what keeps the first column pinned
          // horizontally and the header pinned vertically at the same time.
          <div
            ref={scrollRef}
            className="relative max-h-[calc(100svh-17rem)] overflow-auto"
          >
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-background sticky top-0 z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b">
                    {headerGroup.headers.map((header, index) => (
                      <th
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className={cn(
                          'text-muted-foreground bg-background px-2.5 py-2 text-left font-medium whitespace-nowrap',
                          index === 0 && 'sticky left-0 z-20 border-r',
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </th>
                    ))}
                    {/* Pinned to the right edge. This table is ~2900px wide
                        across 23 columns, so an unpinned action column sits
                        past the end of the scroll region and is, in practice,
                        unreachable — you would have to scroll the whole table
                        to find out a row can be edited at all. */}
                    <th
                      data-capture-exclude
                      className="bg-background text-muted-foreground sticky right-0 z-20 w-20 border-l px-2.5 py-2 text-right font-medium"
                    >
                      Aksi
                    </th>
                  </tr>
                ))}
              </thead>

              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 group border-b transition-colors"
                  >
                    {row.getVisibleCells().map((cell, index) => {
                      const meta = cell.column.columnDef.meta as
                        { column?: MonthlyColumnDto } | undefined;
                      const definition = meta?.column;
                      const isNumeric =
                        definition && NUMERIC_TYPES.has(definition.dataType);

                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'px-2.5 py-1.5 whitespace-nowrap',
                            isNumeric && 'text-right tabular-nums',
                            index === 0 &&
                              'bg-background group-hover:bg-muted/40 sticky left-0 z-10 border-r font-medium',
                          )}
                        >
                          {index === 0 || cell.column.id === 'site' ? (
                            cell.column.id === 'site' ? (
                              <Badge variant="secondary" className="font-normal">
                                {String(cell.getValue())}
                              </Badge>
                            ) : (
                              String(cell.getValue())
                            )
                          ) : definition ? (
                            formatCell(cell.getValue() as CellValue, definition)
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}

                    <td
                      data-capture-exclude
                      className="bg-background group-hover:bg-muted/40 sticky right-0 z-10 border-l px-2"
                    >
                      {/* Always visible, not revealed on hover: a hover-only
                          control does not exist at all on a touch device, and
                          even with a mouse it hides that the row is actionable
                          until you happen to pass over it. Excluded from the
                          image capture. */}
                      <div className="flex items-center justify-end gap-0.5">
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ubah laporan ${row.original.reportDate}`}
                            onClick={() => setEditing(row.original)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        <RecordInfoPopover
                          createdAt={row.original.createdAt}
                          updatedAt={row.original.updatedAt}
                          createdBy={row.original.createdBy}
                          updatedBy={row.original.updatedBy}
                          label={row.original.reportDate}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals are computed server-side over the page, so the footer
                  agrees with the rows above it rather than re-deriving them
                  from values already rounded for display. */}
              <tfoot className="bg-muted/50 sticky bottom-0">
                <tr className="border-t-2">
                  {table.getVisibleLeafColumns().map((column, index) => {
                    const meta = column.columnDef.meta as
                      { column?: MonthlyColumnDto } | undefined;
                    const definition = meta?.column;
                    const total = definition ? totals[definition.key] : undefined;

                    return (
                      <td
                        key={column.id}
                        className={cn(
                          'px-2.5 py-2 font-medium whitespace-nowrap',
                          index === 0 && 'bg-muted/50 sticky left-0 z-10 border-r',
                          total !== undefined && 'text-right tabular-nums',
                        )}
                      >
                        {index === 0
                          ? 'Total'
                          : total !== undefined && definition
                            ? formatCell(total, definition)
                            : ''}
                      </td>
                    );
                  })}
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

      <MonthlyEditDialog
        open={creating || editing !== null}
        row={editing}
        columns={dynamicColumns}
        banks={banks}
        sites={sites}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['monthly'] });
        }}
      />
    </div>
  );
}
