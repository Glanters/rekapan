'use client';

import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { Envelope, ImportResult, TransferModule } from './types';

/** Errors listed in full before the tail is summarised. */
const MAX_LISTED_ERRORS = 100;

interface ImportDialogProps {
  open: boolean;
  module: TransferModule;
  onClose: () => void;
  /** Fired after a successful commit so the table can refetch. */
  onImported: () => void;
}

/**
 * Two-phase import.
 *
 * The preview and the commit are separate requests over the same file. The file
 * is re-sent rather than parked on the server between them: holding uploads
 * server-side would need storage and expiry for something the browser already
 * has in hand. The commit re-validates from scratch, so its verdicts are current
 * even if the data moved underneath the preview.
 */
export function ImportDialog({ open, module, onClose, onImported }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setBusy(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function send(selected: File, dryRun: boolean): Promise<ImportResult | null> {
    const form = new FormData();
    form.append('file', selected);

    const response = await fetch(`/api/${module}/import?dryRun=${String(dryRun)}`, {
      method: 'POST',
      body: form,
    });

    const payload = (await response.json()) as Envelope<ImportResult>;
    if (!payload.success || !payload.data) {
      toast.error(payload.message);
      return null;
    }

    return payload.data;
  }

  async function handleSelect(selected: File | null) {
    setFile(selected);
    setPreview(null);
    if (!selected) return;

    setBusy('preview');
    try {
      const result = await send(selected, true);
      if (result) setPreview(result);
    } catch {
      toast.error('Tidak dapat mengunggah berkas. Periksa koneksi Anda.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit() {
    if (!file) return;

    setBusy('commit');
    try {
      const result = await send(file, false);
      if (!result) return;

      toast.success(
        `${result.successRows.toLocaleString('id-ID')} baris tersimpan.` +
          (result.failedRows > 0
            ? ` ${result.failedRows.toLocaleString('id-ID')} baris dilewati.`
            : ''),
      );
      onImported();
      handleClose();
    } catch {
      toast.error('Tidak dapat menyimpan. Periksa koneksi Anda.');
    } finally {
      setBusy(null);
    }
  }

  const failedRows = preview?.rows.filter((row) => !row.valid) ?? [];
  const listed = failedRows.slice(0, MAX_LISTED_ERRORS);
  const canCommit = preview !== null && preview.successRows > 0 && busy === null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Impor data</DialogTitle>
          <DialogDescription>
            Unggah berkas .xlsx atau .csv. Data akan diperiksa terlebih dahulu, dan
            tidak ada yang tersimpan sebelum Anda menekan Simpan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-file">Berkas</Label>
            <Input
              id="import-file"
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv"
              disabled={busy !== null}
              onChange={(event) => void handleSelect(event.target.files?.[0] ?? null)}
            />
            <p className="text-muted-foreground text-xs">
              Belum punya berkasnya? Unduh templat dari tombol Templat di toolbar.
            </p>
          </div>

          {busy === 'preview' && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Memeriksa berkas…
            </div>
          )}

          {!file && busy === null && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
              <FileUp className="size-4" />
              Pilih berkas untuk melihat pratinjau.
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <Alert variant={preview.failedRows > 0 ? 'destructive' : 'default'}>
                {preview.failedRows > 0 ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                <AlertTitle>
                  {preview.successRows.toLocaleString('id-ID')} dari{' '}
                  {preview.totalRows.toLocaleString('id-ID')} baris siap disimpan
                </AlertTitle>
                <AlertDescription>
                  {preview.failedRows > 0
                    ? `${preview.failedRows.toLocaleString('id-ID')} baris bermasalah dan akan dilewati. Perbaiki baris tersebut lalu unggah ulang berkas yang sama — baris yang sudah benar tidak akan terduplikasi.`
                    : 'Semua baris lolos pemeriksaan.'}
                </AlertDescription>
              </Alert>

              {preview.recognisedColumns.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">Kolom terbaca:</span>
                  {preview.recognisedColumns.map((column) => (
                    <Badge key={column} variant="secondary" className="font-normal">
                      {column}
                    </Badge>
                  ))}
                </div>
              )}

              {listed.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead className="w-16">Baris</TableHead>
                        <TableHead className="w-24">Site</TableHead>
                        <TableHead className="w-28">Tanggal</TableHead>
                        <TableHead>Masalah</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listed.map((row) => (
                        <TableRow key={row.row}>
                          <TableCell className="tabular-nums">{row.row}</TableCell>
                          <TableCell>{row.siteCode ?? '—'}</TableCell>
                          <TableCell className="tabular-nums">
                            {row.reportDate ?? '—'}
                          </TableCell>
                          <TableCell className="text-destructive">
                            {row.errors.join('; ')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {failedRows.length > listed.length && (
                <p className="text-muted-foreground text-xs">
                  Dan {(failedRows.length - listed.length).toLocaleString('id-ID')}{' '}
                  baris bermasalah lainnya.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy === 'commit'}>
            Batal
          </Button>
          <Button onClick={() => void handleCommit()} disabled={!canCommit}>
            {busy === 'commit' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {preview
              ? `Simpan ${preview.successRows.toLocaleString('id-ID')} baris`
              : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
