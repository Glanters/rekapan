'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

import type { SiteRef, TurnoverGameDto, TurnoverRowDto } from './types';

interface TurnoverEditDialogProps {
  open: boolean;
  row: TurnoverRowDto | null;
  games: TurnoverGameDto[];
  sites: SiteRef[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create/edit form for one day's turnover.
 *
 * Fields come from the game list, so a game added in Master Data appears here
 * without a code change — the same derivation the table itself uses.
 */
export function TurnoverEditDialog({
  open,
  row,
  games,
  sites,
  onClose,
  onSaved,
}: TurnoverEditDialogProps) {
  const [siteId, setSiteId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (row) {
      setSiteId(row.siteId);
      setReportDate(row.reportDate);
      setValues(
        Object.fromEntries(
          games.map((game) => {
            const value = row.values[game.code];
            return [
              game.code,
              value === null || value === undefined ? '' : String(value),
            ];
          }),
        ),
      );
    } else {
      setSiteId(sites[0]?.id ?? '');
      setReportDate(new Date().toISOString().slice(0, 10));
      setValues({});
    }
  }, [open, row, games, sites]);

  const grouped = useMemo(() => {
    const map = new Map<string, TurnoverGameDto[]>();
    for (const game of games) {
      const key = game.category ?? 'Lainnya';
      const bucket = map.get(key);
      if (bucket) bucket.push(game);
      else map.set(key, [game]);
    }
    return [...map.entries()];
  }, [games]);

  /** Live preview of the day's total, so a typo is visible before saving. */
  const runningTotal = useMemo(
    () =>
      Object.values(values).reduce((sum, raw) => {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? sum + parsed : sum;
      }, 0),
    [values],
  );

  async function handleSave() {
    if (!siteId || !reportDate) {
      toast.error('Site dan tanggal wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      // Blank means zero here, not "leave alone": a game with no turnover on a
      // given day is a real zero, and omitting it would preserve a stale figure.
      const payload: Record<string, number | null> = {};
      for (const game of games) {
        const raw = values[game.code];
        payload[game.code] = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
      }

      const invalid = Object.entries(payload).find(
        ([, value]) => !Number.isFinite(value),
      );
      if (invalid) {
        toast.error(`Nilai untuk ${invalid[0]} bukan angka yang valid.`);
        return;
      }

      const response = await fetch('/api/turnover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, reportDate, values: payload }),
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
          <DialogTitle>{row ? 'Ubah turnover' : 'Tambah turnover'}</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.siteName} · ${row.reportDate}`
              : 'Satu laporan per site per tanggal. Mengirim ulang tanggal yang sama akan memperbarui laporan yang ada.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="t-site">Site</Label>
              <select
                id="t-site"
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
              <Label htmlFor="t-date">Tanggal</Label>
              <Input
                id="t-date"
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                disabled={row !== null}
              />
            </div>
          </div>

          {grouped.map(([category, categoryGames]) => (
            <div key={category} className="space-y-3">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                {category}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {categoryGames.map((game) => (
                  <div key={game.id} className="space-y-1.5">
                    <Label htmlFor={game.code} className="text-xs" title={game.name}>
                      {game.code}
                    </Label>
                    <Input
                      id={game.code}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={values[game.code] ?? ''}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [game.code]: e.target.value }))
                      }
                      placeholder="0"
                      className="text-right tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="bg-muted/50 flex items-center justify-between rounded-lg px-4 py-3">
            <span className="text-sm font-medium">Total</span>
            <span className="font-semibold tabular-nums">
              {runningTotal.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
            </span>
          </div>
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
