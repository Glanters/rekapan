'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

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

import type {
  BankDto,
  CellValue,
  MonthlyColumnDto,
  MonthlyRowDto,
  SiteRef,
} from './types';

interface MonthlyEditDialogProps {
  open: boolean;
  /** Null when creating a new report. */
  row: MonthlyRowDto | null;
  columns: MonthlyColumnDto[];
  /** Active banks; the columns of the Validasi breakdown. */
  banks: BankDto[];
  sites: SiteRef[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create/edit form for one day's report.
 *
 * The fields are generated from the column definitions rather than written out,
 * so a column added by an administrator appears here automatically — the same
 * reason the table itself is derived from the API response.
 */
export function MonthlyEditDialog({
  open,
  row,
  columns,
  banks,
  sites,
  onClose,
  onSaved,
}: MonthlyEditDialogProps) {
  const [siteId, setSiteId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  /** Per-bank member counts, keyed by bank code. */
  const [validations, setValidations] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset whenever the dialog opens, so a previous edit never bleeds into the
  // next one.
  useEffect(() => {
    if (!open) return;

    if (row) {
      setSiteId(row.siteId);
      setReportDate(row.reportDate);
      setValues(
        Object.fromEntries(
          columns.map((column) => {
            const value = row.values[column.key];
            return [
              column.key,
              value === null || value === undefined ? '' : String(value),
            ];
          }),
        ),
      );
      setValidations(
        Object.fromEntries(
          banks.map((bank) => {
            const count = row.validations[bank.code];
            return [bank.code, count === undefined ? '' : String(count)];
          }),
        ),
      );
    } else {
      setSiteId(sites[0]?.id ?? '');
      setReportDate(new Date().toISOString().slice(0, 10));
      setValues({});
      setValidations({});
    }
  }, [open, row, columns, banks, sites]);

  /**
   * The result the server will derive, recomputed as the operator types.
   *
   * Mirrors `applyResultEffect` on the server. Duplicated deliberately: the
   * alternative is a round trip per keystroke, and the arithmetic is one line.
   * The server's value is still authoritative — this only previews it.
   */
  const previewResult = columns.reduce((sum, column) => {
    if (column.resultEffect !== 'ADD' && column.resultEffect !== 'SUBTRACT') return sum;
    const raw = Number(values[column.key] ?? 0);
    if (!Number.isFinite(raw)) return sum;
    return column.resultEffect === 'ADD' ? sum + raw : sum - raw;
  }, 0);

  /** Live sum of the per-bank counts — the Validasi figure the server derives. */
  const validationTotal = banks.reduce((sum, bank) => {
    const raw = Number(validations[bank.code] ?? 0);
    return Number.isFinite(raw) ? sum + raw : sum;
  }, 0);

  const grouped = columns.reduce<Map<string, MonthlyColumnDto[]>>((acc, column) => {
    const key = column.group ?? 'Lainnya';
    const bucket = acc.get(key);
    if (bucket) bucket.push(column);
    else acc.set(key, [column]);
    return acc;
  }, new Map());

  async function handleSave() {
    if (!siteId || !reportDate) {
      toast.error('Site dan tanggal wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      // Blank fields are sent as null rather than omitted: omitting would leave
      // a previous value in place, so clearing a cell would silently not save.
      const payload: Record<string, CellValue> = {};
      for (const column of columns) {
        const raw = values[column.key];
        payload[column.key] = raw === undefined || raw.trim() === '' ? null : raw;
      }

      const response = await fetch('/api/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Always sent, never omitted: an omitted breakdown means "leave it
        // alone", so clearing a bank in the form would silently not save.
        body: JSON.stringify({
          siteId,
          reportDate,
          values: payload,
          validations: Object.fromEntries(
            banks.map((bank) => {
              const raw = validations[bank.code];
              const count = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
              return [
                bank.code,
                Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
              ];
            }),
          ),
        }),
      });

      const result = (await response.json()) as { success: boolean; message: string };
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      onSaved();
    } catch {
      toast.error('Tidak dapat menyimpan. Periksa koneksi Anda.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? 'Ubah laporan' : 'Tambah laporan'}</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.siteName} · ${row.reportDate}`
              : 'Satu laporan per site per tanggal. Mengirim ulang tanggal yang sama akan memperbarui laporan yang ada.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="site">Site</Label>
              <select
                id="site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={row !== null}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm disabled:opacity-60"
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Tanggal</Label>
              <Input
                id="date"
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                disabled={row !== null}
              />
            </div>
          </div>

          {banks.length > 0 && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                  Validasi per bank
                </p>
                <span className="text-sm">
                  <span className="text-muted-foreground">Total </span>
                  <span className="font-semibold tabular-nums">
                    {validationTotal.toLocaleString('id-ID')}
                  </span>
                  <span className="text-muted-foreground"> member</span>
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {banks.map((bank) => (
                  <div key={bank.id} className="space-y-1.5">
                    <Label
                      htmlFor={`bank-${bank.code}`}
                      className="text-xs"
                      title={bank.name}
                    >
                      {bank.code}
                    </Label>
                    <Input
                      id={`bank-${bank.code}`}
                      type="number"
                      inputMode="numeric"
                      // A head count: whole people, never negative.
                      step="1"
                      min="0"
                      value={validations[bank.code] ?? ''}
                      onChange={(e) =>
                        setValidations((prev) => ({
                          ...prev,
                          [bank.code]: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="text-right tabular-nums"
                    />
                  </div>
                ))}
              </div>

              <p className="text-muted-foreground text-xs">
                Jumlah member yang mendaftar pada tanggal ini, dirinci per bank.
                Totalnya mengisi kolom Validasi secara otomatis.
              </p>
            </div>
          )}

          {[...grouped.entries()].map(([group, groupColumns]) => (
            <div key={group} className="space-y-3">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                {group}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {groupColumns.map((column) =>
                  column.computation === 'VALIDATION_TOTAL' ? (
                    // Derived from the per-bank breakdown below. Editable here
                    // it would just disagree with the numbers it is a sum of.
                    <div key={column.key} className="space-y-1.5">
                      <Label className="text-xs">
                        {column.label}
                        <span className="text-muted-foreground">
                          {' '}
                          · dari rincian bank
                        </span>
                      </Label>
                      <div className="bg-muted/60 border-input flex h-9 items-center justify-end rounded-md border px-3 text-sm font-semibold tabular-nums">
                        {validationTotal.toLocaleString('id-ID')}
                      </div>
                    </div>
                  ) : column.resultEffect === 'RESULT' ? (
                    // Derived, so there is nothing to type here. Rendered in
                    // place rather than hidden, because operators look for this
                    // figure where it has always been — omitting it would read
                    // as the column having disappeared.
                    <div key={column.key} className="space-y-1.5">
                      <Label className="text-xs">
                        {column.label}
                        <span className="text-muted-foreground"> · otomatis</span>
                      </Label>
                      <div className="bg-muted/60 border-input flex h-9 items-center justify-end rounded-md border px-3 text-sm font-semibold tabular-nums">
                        {previewResult.toLocaleString('id-ID', {
                          minimumFractionDigits: column.precision,
                          maximumFractionDigits: column.precision,
                        })}
                      </div>
                    </div>
                  ) : (
                    <div key={column.key} className="space-y-1.5">
                      <Label htmlFor={column.key} className="text-xs">
                        {column.label}
                        {column.resultEffect === 'ADD' && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {' '}
                            +
                          </span>
                        )}
                        {column.resultEffect === 'SUBTRACT' && (
                          <span className="text-red-600 dark:text-red-400"> −</span>
                        )}
                        {column.isRequired && (
                          <span className="text-destructive"> *</span>
                        )}
                      </Label>
                      <Input
                        id={column.key}
                        type={
                          column.dataType === 'DATE'
                            ? 'date'
                            : column.dataType === 'TEXT'
                              ? 'text'
                              : 'number'
                        }
                        inputMode={
                          column.dataType === 'INTEGER'
                            ? 'numeric'
                            : column.dataType === 'TEXT'
                              ? 'text'
                              : 'decimal'
                        }
                        step={column.dataType === 'INTEGER' ? '1' : 'any'}
                        value={values[column.key] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [column.key]: e.target.value,
                          }))
                        }
                        placeholder="0"
                      />
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
