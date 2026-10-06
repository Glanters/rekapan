'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FilePlus2, Loader2, PencilLine } from 'lucide-react';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface HistoryChange {
  label: string;
  before: number | string | boolean | null;
  after: number | string | boolean | null;
  digits: number | null;
}

interface HistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted' | 'other';
  at: string;
  actor: string;
  source: 'form' | 'import' | null;
  changes: HistoryChange[] | null;
}

interface EditStampProps {
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  /** Names the row in the accessible label, e.g. the report date. */
  label: string;
  /** Endpoint returning this row's edit history; omitted, the popover shows the stamp only. */
  historyUrl?: string;
}

/**
 * A save within this many ms of creation is the same act of entering the
 * report (the create, then the bank breakdown), not a later edit.
 */
const SAME_ENTRY_MS = 60_000;

function when(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  return { date: format(at, 'dd/MM/yyyy'), time: format(at, 'HH:mm') };
}

function show(value: HistoryChange['before'], digits: number | null): string {
  if (value === null || value === '') return 'kosong';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'number') {
    return value.toLocaleString('id-ID', {
      minimumFractionDigits: digits ?? 0,
      maximumFractionDigits: digits ?? 4,
    });
  }
  return value;
}

const ACTION_LABEL: Record<HistoryEntry['action'], string> = {
  created: 'Dibuat',
  updated: 'Diubah',
  deleted: 'Dihapus',
  other: 'Aktivitas',
};

/**
 * Who last touched a row, and when — visible in the table itself rather than
 * behind an info icon, so an edited figure is never mistaken for an original.
 *
 * An edited row is marked (pencil, amber); an untouched one reads quietly as
 * "Dibuat". Clicking opens the row's history: each save, who made it, and the
 * figures it changed from → to.
 */
export function EditStamp({
  createdAt,
  updatedAt,
  createdBy,
  updatedBy,
  label,
  historyUrl,
}: EditStampProps) {
  const [open, setOpen] = useState(false);
  const edited =
    new Date(updatedAt).getTime() - new Date(createdAt).getTime() > SAME_ENTRY_MS;
  const actor = (edited ? updatedBy : createdBy) ?? 'Sistem';
  const stamp = when(edited ? updatedAt : createdAt);

  const history = useQuery({
    queryKey: ['row-history', historyUrl],
    enabled: open && Boolean(historyUrl),
    queryFn: async () => {
      const response = await fetch(historyUrl!);
      const payload = (await response.json()) as {
        success: boolean;
        message: string;
        data: HistoryEntry[] | null;
      };
      if (!payload.success) throw new Error(payload.message);
      return payload.data ?? [];
    },
  });

  const Icon = edited ? PencilLine : FilePlus2;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${edited ? 'Diedit' : 'Dibuat'} oleh ${actor}, ${stamp.date} ${stamp.time}. Lihat riwayat laporan ${label}`}
        className={cn(
          'focus-visible:ring-ring/50 hover:bg-muted -mx-1 flex min-w-0 items-start gap-1.5 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-3',
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-3.5 shrink-0',
            edited ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
          )}
        />
        <span className="min-w-0 leading-tight">
          <span
            className={cn(
              'block max-w-32 truncate text-xs',
              edited ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            {edited ? 'Diedit' : 'Dibuat'} · {actor}
          </span>
          <span className="text-muted-foreground block text-[11px] tabular-nums">
            {stamp.date} · {stamp.time}
          </span>
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-semibold">Riwayat laporan {label}</p>
          <p className="text-muted-foreground text-xs">
            Dibuat {when(createdAt).date} {when(createdAt).time} oleh{' '}
            {createdBy ?? 'Sistem'}
          </p>
        </div>

        {!historyUrl ? (
          <p className="px-3 py-3 text-xs">
            Terakhir diubah {when(updatedAt).date} {when(updatedAt).time} oleh{' '}
            {updatedBy ?? 'Sistem'}
          </p>
        ) : history.isLoading ? (
          <p className="text-muted-foreground flex items-center gap-2 px-3 py-3 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Memuat riwayat…
          </p>
        ) : history.isError ? (
          <p className="text-destructive px-3 py-3 text-xs">
            {(history.error as Error).message || 'Riwayat gagal dimuat.'}
          </p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-muted-foreground px-3 py-3 text-xs">
            Belum ada riwayat tercatat untuk laporan ini.
          </p>
        ) : (
          <ol className="max-h-80 divide-y overflow-y-auto">
            {history.data!.map((entry) => {
              const at = when(entry.at);
              return (
                <li key={entry.id} className="space-y-1 px-3 py-2 text-xs">
                  <p>
                    <span className="font-semibold">{ACTION_LABEL[entry.action]}</span>{' '}
                    oleh <span className="font-medium">{entry.actor}</span>
                    {entry.source === 'import' && (
                      <span className="text-muted-foreground">
                        {' '}
                        · lewat impor Excel
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    {at.date} · {at.time}
                  </p>
                  {entry.changes === null ? (
                    entry.action === 'updated' && (
                      <p className="text-muted-foreground italic">
                        Rincian nilai tidak tersedia untuk perubahan lama.
                      </p>
                    )
                  ) : entry.changes.length === 0 ? (
                    entry.action === 'updated' && (
                      <p className="text-muted-foreground">
                        Disimpan tanpa perubahan nilai.
                      </p>
                    )
                  ) : (
                    <ul className="space-y-0.5">
                      {entry.changes.map((change) => (
                        <li key={change.label} className="flex flex-wrap gap-x-1.5">
                          <span className="font-medium">{change.label}:</span>
                          {entry.action === 'updated' && (
                            <>
                              <span className="text-muted-foreground tabular-nums line-through">
                                {show(change.before, change.digits)}
                              </span>
                              <span aria-hidden>→</span>
                              <span className="sr-only">menjadi</span>
                            </>
                          )}
                          <span className="tabular-nums">
                            {show(change.after, change.digits)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
