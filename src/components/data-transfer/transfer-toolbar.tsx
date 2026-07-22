'use client';

import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { downloadFile } from './download';
import { ImportDialog } from './import-dialog';
import type { TransferFormat, TransferModule } from './types';

interface TransferToolbarProps {
  module: TransferModule;
  /** The filters currently applied to the table, so the file matches the screen. */
  filters: { from: string; to: string; siteId: string };
  canImport: boolean;
  canExport: boolean;
  /** Fired after a successful import so the table can refetch. */
  onImported: () => void;
}

/**
 * Import/export controls for a report table.
 *
 * Shared by Monthly and Turnover: the two modules differ only in the endpoint
 * prefix, and the endpoints already derive their columns from the database, so
 * there is nothing module-specific left for the toolbar to know.
 */
export function TransferToolbar({
  module,
  filters,
  canImport,
  canExport,
  onImported,
}: TransferToolbarProps) {
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(path: string, format: TransferFormat, key: string) {
    const search = new URLSearchParams({ format });
    if (path === 'export') {
      if (filters.from) search.set('from', filters.from);
      if (filters.to) search.set('to', filters.to);
      if (filters.siteId) search.set('siteId', filters.siteId);
    }

    setDownloading(key);
    try {
      await downloadFile(
        `/api/${module}/${path}?${search.toString()}`,
        `${module}_${path}.${format}`,
      );
    } catch (error) {
      // The cap message lands here: an export past the row limit is refused
      // with a reason rather than quietly trimmed, and this is where the
      // operator reads it.
      toast.error(error instanceof Error ? error.message : 'Unduhan gagal.');
    } finally {
      setDownloading(null);
    }
  }

  if (!canImport && !canExport) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {canImport && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void download('template', 'xlsx', 'template')}
            disabled={downloading !== null}
          >
            {downloading === 'template' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-4" />
            )}
            Templat
          </Button>
        )}

        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={downloading !== null} />
              }
            >
              {downloading === 'export' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Ekspor
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Sesuai filter saat ini
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void download('export', 'xlsx', 'export')}
              >
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void download('export', 'csv', 'export')}
              >
                CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canImport && (
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            Impor
          </Button>
        )}
      </div>

      {canImport && (
        <ImportDialog
          open={importing}
          module={module}
          onClose={() => setImporting(false)}
          onImported={onImported}
        />
      )}
    </>
  );
}
