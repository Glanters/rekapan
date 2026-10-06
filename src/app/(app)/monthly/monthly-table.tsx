'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Loader2,
  Plus,
  Table2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { TableImageButton } from '@/components/data-transfer/table-image-button';
import { TransferToolbar } from '@/components/data-transfer/transfer-toolbar';
import { EditStamp } from '@/components/edit-stamp';
import { RowActions } from '@/components/row-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  canDelete: boolean;
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

/** Column id of the "who changed this row" stamp. */
const AUDIT_COLUMN = 'audit';

// The Select needs a concrete value; this one stands for no site filter.
const ALL_SITES = '__all__';

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
  canDelete,
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
  const [pendingDelete, setPendingDelete] = useState<MonthlyRowDto | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/monthly/${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { success: boolean; message: string };
      if (!payload.success) throw new Error(payload.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monthly'] });
      setPendingDelete(null);
      toast.success('Laporan dihapus.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

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
      // Third, not last: with two dozen figure columns a trailing column is
      // off-screen, and who last changed a row is what someone checking a
      // figure needs to see first.
      {
        id: AUDIT_COLUMN,
        header: 'Diubah',
        accessorFn: (row) => row.updatedAt,
        size: 150,
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
      {/* On a phone the primary action sits beside the title and the file
          actions wrap onto their own row below; from lg they share one line.
          A single unwrapping row here was wider than the screen and dragged
          the whole page sideways. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Monthly</h1>
          <p className="text-muted-foreground text-sm">
            {totalRows.toLocaleString('id-ID')} laporan · {dynamicColumns.length} kolom
          </p>
        </div>

        {canEdit && (
          <Button
            className="lg:order-last"
            onClick={() => setCreating(true)}
            disabled={sites.length === 0}
          >
            <Plus className="size-4" />
            Tambah laporan
          </Button>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
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
        </div>
      </div>

      {/* Sticky toolbar: filters stay reachable while a wide table is scrolled. */}
      <Card className="border-border/60 z-20 p-2.5 md:sticky md:top-14">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-auto"
            aria-label="Dari tanggal"
          />
          <span className="text-muted-foreground hidden text-sm sm:inline">—</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-auto"
            aria-label="Sampai tanggal"
          />

          {/* The app Select, not a native <select>: native option lists
              ignore the dark theme and render white on white. */}
          <Select
            items={{
              [ALL_SITES]: 'Semua site',
              ...Object.fromEntries(sites.map((site) => [site.id, site.name])),
            }}
            value={siteId || ALL_SITES}
            onValueChange={(value) => {
              setSiteId(!value || value === ALL_SITES ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Site" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SITES}>Semua site</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex justify-end sm:ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" className="w-full sm:w-auto" />}
              >
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
                        // Audit detail is for the screen, not the shared image.
                        data-capture-exclude={
                          header.column.id === AUDIT_COLUMN ? true : undefined
                        }
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
                      className="bg-background text-muted-foreground sticky right-0 z-20 w-12 border-l px-2.5 py-2 text-right font-medium sm:w-24"
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
                          data-capture-exclude={
                            cell.column.id === AUDIT_COLUMN ? true : undefined
                          }
                          className={cn(
                            'px-2.5 py-1.5 whitespace-nowrap',
                            isNumeric && 'text-right tabular-nums',
                            index === 0 &&
                              'bg-background group-hover:bg-muted-row sticky left-0 z-10 border-r font-medium',
                          )}
                        >
                          {cell.column.id === AUDIT_COLUMN ? (
                            <EditStamp
                              label={row.original.reportDate}
                              createdAt={row.original.createdAt}
                              updatedAt={row.original.updatedAt}
                              createdBy={row.original.createdBy}
                              updatedBy={row.original.updatedBy}
                              historyUrl={`/api/monthly/${row.original.id}/history`}
                            />
                          ) : index === 0 || cell.column.id === 'site' ? (
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
                      className="bg-background group-hover:bg-muted-row sticky right-0 z-10 border-l px-1 sm:px-2"
                    >
                      {/* Always visible, not revealed on hover: a hover-only
                          control does not exist at all on a touch device, and
                          even with a mouse it hides that the row is actionable
                          until you happen to pass over it. Excluded from the
                          image capture. */}
                      <RowActions
                        label={row.original.reportDate}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        onEdit={() => setEditing(row.original)}
                        onDelete={() => setPendingDelete(row.original)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals are computed server-side over the page, so the footer
                  agrees with the rows above it rather than re-deriving them
                  from values already rounded for display. */}
              <tfoot className="bg-muted-soft sticky bottom-0">
                <tr className="border-t-2">
                  {table.getVisibleLeafColumns().map((column, index) => {
                    const meta = column.columnDef.meta as
                      { column?: MonthlyColumnDto } | undefined;
                    const definition = meta?.column;
                    const total = definition ? totals[definition.key] : undefined;

                    return (
                      <td
                        key={column.id}
                        data-capture-exclude={
                          column.id === AUDIT_COLUMN ? true : undefined
                        }
                        className={cn(
                          'px-2.5 py-2 font-medium whitespace-nowrap',
                          index === 0 && 'bg-muted-soft sticky left-0 z-10 border-r',
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
                    className="bg-muted-soft sticky right-0 z-10 border-l"
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
          void queryClient.invalidateQueries({ queryKey: ['row-history'] });
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus laporan</DialogTitle>
            <DialogDescription>
              Laporan Monthly tanggal{' '}
              <span className="font-medium">{pendingDelete?.reportDate}</span> untuk
              site <span className="font-medium">{pendingDelete?.siteCode}</span> akan
              dihapus dari tabel. Penghapusan bersifat halus — data tetap tercatat di
              audit dan dapat dipulihkan bila diperlukan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
