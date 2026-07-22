'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  ScrollText,
  Search,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const ALL_MODULES = '__all__';
const PER_PAGE = 50;
const COLUMN_COUNT = 8;

interface AuditRow {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  module: string;
  siteId: string | null;
  siteCode: string | null;
  siteName: string | null;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
  };
}

interface Filters {
  module: string;
  action: string;
  actorEmail: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  module: ALL_MODULES,
  action: '',
  actorEmail: '',
  from: '',
  to: '',
};

async function fetchPage(
  filters: Filters,
  page: number,
): Promise<Envelope<AuditRow[]>> {
  const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
  if (filters.module !== ALL_MODULES) params.set('module', filters.module);
  if (filters.action.trim()) params.set('action', filters.action.trim());
  if (filters.actorEmail.trim()) params.set('actorEmail', filters.actorEmail.trim());
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);

  const response = await fetch(`/api/admin/audit?${params.toString()}`);
  const payload = (await response.json()) as Envelope<AuditRow[]>;
  if (!payload.success) throw new Error(payload.message);
  return payload;
}

/**
 * Audit trail viewer.
 *
 * Strictly read-only — there is no action, menu, or endpoint here that edits or
 * removes an entry, because a trail its own administrators can rewrite is not
 * evidence of anything.
 *
 * The table is expected to reach millions of rows, so the client never holds
 * more than one server-bounded page and filtering is applied server-side. That
 * is also why filters are committed with a button instead of being applied per
 * keystroke: each change is a fresh indexed query, not a filter over a list
 * already in memory.
 */
export function AuditClient({ modules }: { modules: string[] }) {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-audit', applied, page],
    queryFn: () => fetchPage(applied, page),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash an empty table.
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const totalPages = data?.meta.totalPages ?? 1;
  const isFiltered = JSON.stringify(applied) !== JSON.stringify(EMPTY_FILTERS);

  const moduleItems = [
    { value: ALL_MODULES, label: 'Semua modul' },
    ...modules.map((module) => ({ value: module, label: module })),
  ];

  function apply() {
    setApplied(draft);
    setPage(1);
    setExpanded(null);
  }

  function reset() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
    setExpanded(null);
  }

  const firstShown = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const lastShown = Math.min(page * PER_PAGE, total);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground text-sm">
            Catatan setiap perubahan. Bersifat hanya-baca dan tidak dapat diubah atau
            dihapus.
          </p>
        </div>
        {isFetching && !isLoading && (
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" />
            Memuat…
          </span>
        )}
      </div>

      <Card className="border-border/60">
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="audit-module" className="text-xs">
                Modul
              </Label>
              <Select
                items={moduleItems}
                value={draft.module}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    module: typeof value === 'string' ? value : ALL_MODULES,
                  }))
                }
              >
                <SelectTrigger id="audit-module" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {moduleItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-action" className="text-xs">
                Aksi
              </Label>
              <Input
                id="audit-action"
                value={draft.action}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, action: event.target.value }))
                }
                placeholder="mis. user.activated"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-actor" className="text-xs">
                Email aktor
              </Label>
              <Input
                id="audit-actor"
                value={draft.actorEmail}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, actorEmail: event.target.value }))
                }
                placeholder="nama@perusahaan.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-from" className="text-xs">
                Dari tanggal
              </Label>
              <Input
                id="audit-from"
                type="date"
                value={draft.from}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, from: event.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-to" className="text-xs">
                Sampai tanggal
              </Label>
              <Input
                id="audit-to"
                type="date"
                value={draft.to}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, to: event.target.value }))
                }
              />
            </div>

            <div className="flex items-end gap-2">
              <Button type="submit" className="flex-1">
                <Search className="size-4" />
                Terapkan
              </Button>
              {isFiltered && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={reset}
                  aria-label="Atur ulang filter"
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/60 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead className="whitespace-nowrap">Waktu</TableHead>
                <TableHead>Aktor</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Modul</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Entitas</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={COLUMN_COUNT}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={COLUMN_COUNT}
                    className="text-muted-foreground py-12 text-center"
                  >
                    <ScrollText className="mx-auto mb-2 size-6 opacity-50" />
                    {isFiltered
                      ? 'Tidak ada catatan yang cocok dengan filter.'
                      : 'Belum ada catatan audit.'}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((row) => (
                <AuditRowView
                  key={row.id}
                  row={row}
                  expanded={expanded === row.id}
                  onToggle={() =>
                    setExpanded((prev) => (prev === row.id ? null : row.id))
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {total === 0
            ? 'Tidak ada catatan.'
            : `Menampilkan ${firstShown}–${lastShown} dari ${total.toLocaleString('id-ID')} catatan`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isFetching}
            onClick={() => {
              setPage((prev) => Math.max(1, prev - 1));
              setExpanded(null);
            }}
          >
            <ChevronLeft className="size-4" />
            Sebelumnya
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isFetching}
            onClick={() => {
              setPage((prev) => prev + 1);
              setExpanded(null);
            }}
          >
            Berikutnya
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuditRowView({
  row,
  expanded,
  onToggle,
}: {
  row: AuditRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const timestamp = new Date(row.createdAt);
  const hasDetail = row.before !== null || row.after !== null;

  return (
    <>
      <TableRow
        className={cn('cursor-pointer', expanded && 'bg-muted/50 hover:bg-muted/50')}
        onClick={onToggle}
      >
        <TableCell>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 transition-transform',
              !expanded && '-rotate-90',
            )}
            aria-hidden
          />
          <span className="sr-only">{expanded ? 'Tutup detail' : 'Lihat detail'}</span>
        </TableCell>

        <TableCell className="whitespace-nowrap tabular-nums">
          <span className="text-sm">{format(timestamp, 'dd/MM/yyyy')}</span>
          <span className="text-muted-foreground ml-2 text-xs">
            {format(timestamp, 'HH:mm:ss')}
          </span>
        </TableCell>

        <TableCell className="text-sm">
          {row.actorEmail ?? <span className="text-muted-foreground">Sistem</span>}
        </TableCell>

        <TableCell>
          <code className="text-xs">{row.action}</code>
        </TableCell>

        <TableCell>
          <Badge variant="secondary" className="font-normal">
            {row.module}
          </Badge>
        </TableCell>

        <TableCell className="text-sm">
          {row.siteCode ? (
            <Badge
              variant="outline"
              className="font-normal"
              title={row.siteName ?? undefined}
            >
              {row.siteCode}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell className="text-sm">
          {row.entityType ? (
            <div className="flex flex-col">
              <span>{row.entityType}</span>
              {row.entityId && (
                <span className="text-muted-foreground font-mono text-xs">
                  {row.entityId.slice(0, 8)}…
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell className="text-muted-foreground font-mono text-xs">
          {row.ip ?? '—'}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30 p-0">
            <div className="space-y-4 px-4 py-4">
              <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                <div>
                  <dt className="inline font-medium">ID catatan: </dt>
                  <dd className="inline font-mono">{row.id}</dd>
                </div>
                {row.siteName && (
                  <div>
                    <dt className="inline font-medium">Site: </dt>
                    <dd className="inline">
                      {row.siteName}
                      {row.siteCode && ` (${row.siteCode})`}
                    </dd>
                  </div>
                )}
                {row.requestId && (
                  <div>
                    <dt className="inline font-medium">Request ID: </dt>
                    <dd className="inline font-mono">{row.requestId}</dd>
                  </div>
                )}
                {row.entityId && (
                  <div>
                    <dt className="inline font-medium">Entity ID: </dt>
                    <dd className="inline font-mono">{row.entityId}</dd>
                  </div>
                )}
              </dl>

              {hasDetail ? (
                <JsonDiff before={row.before} after={row.after} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Catatan ini tidak menyimpan perubahan nilai.
                </p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/**
 * Side-by-side before/after view.
 *
 * When both sides are plain objects the fields are aligned and the ones that
 * actually moved are highlighted; a raw dump of two JSON blobs makes the reader
 * do that comparison by eye. Anything else falls back to the blobs.
 */
function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeObject = isPlainObject(before) ? before : null;
  const afterObject = isPlainObject(after) ? after : null;

  if (!beforeObject && !afterObject) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <JsonBlock title="Sebelum" value={before} />
        <JsonBlock title="Sesudah" value={after} />
      </div>
    );
  }

  const keys = [
    ...new Set([...Object.keys(beforeObject ?? {}), ...Object.keys(afterObject ?? {})]),
  ].sort();

  return (
    <div className="border-border/60 overflow-hidden rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr className="text-muted-foreground text-left">
            <th className="w-1/4 px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Sebelum</th>
            <th className="px-3 py-2 font-medium">Sesudah</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const beforeValue = beforeObject ? beforeObject[key] : undefined;
            const afterValue = afterObject ? afterObject[key] : undefined;
            const changed =
              JSON.stringify(beforeValue ?? null) !==
              JSON.stringify(afterValue ?? null);

            return (
              <tr
                key={key}
                className={cn('border-border/60 border-t', changed && 'bg-amber-500/5')}
              >
                <td className="px-3 py-2 font-mono font-medium">{key}</td>
                <td
                  className={cn(
                    'px-3 py-2 font-mono break-all whitespace-pre-wrap',
                    changed
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {formatValue(beforeValue)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 font-mono break-all whitespace-pre-wrap',
                    changed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {formatValue(afterValue)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{title}</p>
      <pre className="border-border/60 bg-background overflow-x-auto rounded-lg border p-3 font-mono text-xs">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
