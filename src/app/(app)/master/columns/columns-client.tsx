'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Columns3,
  Info,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sigma,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { RESULT_EFFECTS, RESULT_EFFECT_LABELS } from '@/server/columns/schema';
import { cn } from '@/lib/utils';

/**
 * Monthly column definitions.
 *
 * Each row here is a COLUMN of the Monthly table. The grid is
 * entity–attribute–value, so a definition added here widens every Monthly
 * report at once, `dataType` decides which input widget operators get, and
 * `position` decides where the column lands. Positions are sparse (10, 20, 30)
 * precisely so a new column can be slotted between two existing ones without
 * renumbering everything after it.
 */

type ColumnDataType =
  'CURRENCY' | 'DECIMAL' | 'INTEGER' | 'PERCENT' | 'TEXT' | 'DATE' | 'BOOLEAN';

interface ColumnRow {
  id: string;
  key: string;
  label: string;
  group: string | null;
  dataType: ColumnDataType;
  position: number;
  precision: number;
  unit: string | null;
  isRequired: boolean;
  isVisible: boolean;
  isSystem: boolean;
  includeInTotals: boolean;
  resultEffect: ResultEffectValue;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

interface ColumnsClientProps {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const DATA_TYPE_ITEMS: Record<string, string> = {
  CURRENCY: 'Mata uang',
  DECIMAL: 'Desimal',
  INTEGER: 'Bilangan bulat',
  PERCENT: 'Persentase',
  TEXT: 'Teks',
  DATE: 'Tanggal',
  BOOLEAN: 'Ya / Tidak',
};

const DATA_TYPES = [
  'CURRENCY',
  'DECIMAL',
  'INTEGER',
  'PERCENT',
  'TEXT',
  'DATE',
  'BOOLEAN',
] as const;

type ResultEffectValue = (typeof RESULT_EFFECTS)[number];

const PRECISION_VALUES = ['0', '1', '2', '3', '4'] as const;

type PrecisionValue = (typeof PRECISION_VALUES)[number];

const PRECISION_ITEMS: Record<string, string> = {
  '0': '0 (bulat)',
  '1': '1 angka',
  '2': '2 angka',
  '3': '3 angka',
  '4': '4 angka',
};

/**
 * Narrows a stored precision to the values the picker offers. A row predating
 * the current cap would otherwise be cast into a option that does not exist,
 * leaving the trigger blank.
 */
function toPrecisionValue(precision: number | undefined): PrecisionValue {
  return PRECISION_VALUES.find((value) => value === String(precision)) ?? '2';
}

const ColumnFormSchema = z.object({
  key: z
    .string()
    .min(2, 'Key minimal 2 karakter.')
    .max(64, 'Key maksimal 64 karakter.')
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*$/,
      'Key harus diawali huruf dan hanya boleh berisi huruf, angka, dan _.',
    ),
  label: z
    .string()
    .min(1, 'Label wajib diisi.')
    .max(128, 'Label maksimal 128 karakter.'),
  group: z.string().max(64, 'Grup maksimal 64 karakter.'),
  dataType: z.enum(DATA_TYPES),
  // Text rather than number so an empty box means "letakkan di akhir" instead
  // of NaN; the submit handler converts it.
  position: z
    .string()
    .regex(/^\d*$/, 'Posisi harus berupa angka.')
    .refine(
      (value) => value === '' || Number(value) <= 100_000,
      'Posisi terlalu besar.',
    ),
  precision: z.enum(PRECISION_VALUES),
  unit: z.string().max(16, 'Satuan maksimal 16 karakter.'),
  isRequired: z.boolean(),
  isVisible: z.boolean(),
  includeInTotals: z.boolean(),
  resultEffect: z.enum(RESULT_EFFECTS),
});

type ColumnFormValues = z.infer<typeof ColumnFormSchema>;

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) throw new Error(payload.message);
  return payload.data as T;
}

type FormState = { mode: 'create' } | { mode: 'edit'; column: ColumnRow };

export function ColumnsClient({ canCreate, canUpdate, canDelete }: ColumnsClientProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [formState, setFormState] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ColumnRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['master-columns'],
    // Hidden columns are part of what this screen manages, so it asks for them
    // explicitly — unlike the Monthly grid, which renders only visible ones.
    queryFn: () =>
      callApi<{ columns: ColumnRow[] }>('/api/master/columns?includeHidden=true'),
  });

  const mutate = useMutation({
    mutationFn: (input: { url: string; method: string; body?: unknown }) =>
      callApi<ColumnRow>(input.url, {
        method: input.method,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      }),
    onSuccess: (_column, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['master-columns'] });
      setFormState(null);
      setPendingDelete(null);
      toast.success(
        variables.method === 'POST'
          ? 'Kolom dibuat.'
          : variables.method === 'DELETE'
            ? 'Kolom dihapus.'
            : 'Kolom diperbarui.',
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns = data?.columns ?? [];

  const term = search.trim().toLowerCase();
  const filtered = term
    ? columns.filter(
        (column) =>
          column.key.toLowerCase().includes(term) ||
          column.label.toLowerCase().includes(term) ||
          (column.group ?? '').toLowerCase().includes(term),
      )
    : columns;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kolom Monthly</h1>
          <p className="text-muted-foreground text-sm">
            Definisi kolom yang membentuk tabel laporan Monthly.
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari key, label, grup…"
              className="pl-9"
            />
          </div>
          {canCreate && (
            <Button onClick={() => setFormState({ mode: 'create' })}>
              <Plus className="size-4" />
              Tambah kolom
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border/60 bg-muted/30">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-sm">
            Setiap baris di sini adalah satu kolom pada tabel Monthly. Nilai{' '}
            <span className="font-medium">posisi</span> sengaja dibuat berjarak (10, 20,
            30) agar kolom baru dapat disisipkan di antara kolom yang sudah ada — isi 15
            untuk menempatkannya di antara 10 dan 20. Kolom bertanda{' '}
            <span className="text-foreground font-medium">Sistem</span> tidak dapat
            dihapus dan key-nya tidak dapat diubah.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/60 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">Posisi</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Grup</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Sifat</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-muted-foreground py-12 text-center"
                  >
                    <Columns3 className="mx-auto mb-2 size-8 opacity-40" />
                    {columns.length === 0
                      ? 'Belum ada kolom.'
                      : 'Tidak ada kolom yang cocok.'}
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((column) => (
                <TableRow
                  key={column.id}
                  className={cn(!column.isVisible && 'opacity-60')}
                >
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {column.position}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">
                    <span className="flex items-center gap-1.5">
                      {column.key}
                      {column.isSystem && (
                        <Lock
                          className="text-muted-foreground size-3"
                          aria-label="Kolom sistem"
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{column.label}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {column.group ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {DATA_TYPE_ITEMS[column.dataType] ?? column.dataType}
                    {column.unit && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({column.unit})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {/* The result column and its contributors are marked
                          first: how a column feeds the result is the thing an
                          administrator scans this list for. */}
                      {column.resultEffect === 'RESULT' && (
                        <Badge className="gap-1 border-amber-500/30 bg-amber-500/15 font-normal text-amber-700 dark:text-amber-400">
                          <Sigma className="size-3" />
                          Kolom hasil
                        </Badge>
                      )}
                      {column.resultEffect === 'ADD' && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 font-normal text-emerald-700 dark:text-emerald-400"
                        >
                          + hasil
                        </Badge>
                      )}
                      {column.resultEffect === 'SUBTRACT' && (
                        <Badge
                          variant="outline"
                          className="border-red-500/30 bg-red-500/10 font-normal text-red-700 dark:text-red-400"
                        >
                          − hasil
                        </Badge>
                      )}
                      {column.isSystem && (
                        <Badge variant="secondary" className="font-normal">
                          Sistem
                        </Badge>
                      )}
                      {column.isRequired && (
                        <Badge variant="outline" className="font-normal">
                          Wajib
                        </Badge>
                      )}
                      {!column.isVisible && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground font-normal"
                        >
                          Tersembunyi
                        </Badge>
                      )}
                      {column.includeInTotals && (
                        <Badge variant="outline" className="font-normal">
                          Total
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(canUpdate || canDelete) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Aksi"
                              disabled={mutate.isPending}
                            />
                          }
                        >
                          {mutate.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {canUpdate && (
                            <DropdownMenuItem
                              onClick={() => setFormState({ mode: 'edit', column })}
                            >
                              <Pencil className="size-4" />
                              Ubah
                            </DropdownMenuItem>
                          )}
                          {canUpdate && (
                            <DropdownMenuItem
                              onClick={() =>
                                mutate.mutate({
                                  url: `/api/master/columns/${column.id}`,
                                  method: 'PATCH',
                                  body: { isVisible: !column.isVisible },
                                })
                              }
                            >
                              <Check className="size-4" />
                              {column.isVisible ? 'Sembunyikan' : 'Tampilkan'}
                            </DropdownMenuItem>
                          )}
                          {/* A system column cannot be deleted; the server
                              refuses it, so the option is not offered either. */}
                          {canDelete &&
                            !column.isSystem &&
                            column.resultEffect !== 'RESULT' && (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setPendingDelete(column)}
                              >
                                <Trash2 className="size-4" />
                                Hapus
                              </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog
        open={formState !== null}
        onOpenChange={(open) => {
          if (!open) setFormState(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {formState && (
            <ColumnForm
              key={formState.mode === 'edit' ? formState.column.id : 'new'}
              state={formState}
              busy={mutate.isPending}
              onCancel={() => setFormState(null)}
              onSubmit={(values) =>
                mutate.mutate(
                  formState.mode === 'create'
                    ? { url: '/api/master/columns', method: 'POST', body: values }
                    : {
                        url: `/api/master/columns/${formState.column.id}`,
                        method: 'PATCH',
                        body: values,
                      },
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus kolom</DialogTitle>
            <DialogDescription>
              Kolom <span className="font-medium">{pendingDelete?.label}</span> akan
              hilang dari tabel Monthly. Nilai yang sudah tercatat tetap tersimpan dan
              tidak ikut terhapus.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={mutate.isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={mutate.isPending}
              onClick={() =>
                pendingDelete &&
                mutate.mutate({
                  url: `/api/master/columns/${pendingDelete.id}`,
                  method: 'DELETE',
                })
              }
            >
              {mutate.isPending && <Loader2 className="size-4 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ColumnPayload {
  key?: string | undefined;
  label: string;
  group: string | null;
  dataType: ColumnDataType;
  position?: number | undefined;
  precision: number;
  unit: string | null;
  isRequired: boolean;
  isVisible: boolean;
  includeInTotals: boolean;
  resultEffect: ResultEffectValue;
}

function ColumnForm({
  state,
  busy,
  onCancel,
  onSubmit,
}: {
  state: FormState;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: ColumnPayload) => void;
}) {
  const editing = state.mode === 'edit' ? state.column : null;
  // The server refuses a rename for both, so the field is disabled rather
  // than letting the operator type a change that will be rejected on save.
  const keyLocked = (editing?.isSystem ?? false) || editing?.resultEffect === 'RESULT';

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ColumnFormValues>({
    resolver: zodResolver(ColumnFormSchema),
    defaultValues: {
      key: editing?.key ?? '',
      label: editing?.label ?? '',
      group: editing?.group ?? '',
      dataType: editing?.dataType ?? 'CURRENCY',
      position: editing ? String(editing.position) : '',
      precision: toPrecisionValue(editing?.precision),
      unit: editing?.unit ?? '',
      isRequired: editing?.isRequired ?? false,
      isVisible: editing?.isVisible ?? true,
      includeInTotals: editing?.includeInTotals ?? true,
      resultEffect: editing?.resultEffect ?? 'NEUTRAL',
    },
  });

  const dataType = watch('dataType');
  const precision = watch('precision');
  const isRequired = watch('isRequired');
  const isVisible = watch('isVisible');
  const includeInTotals = watch('includeInTotals');
  const resultEffect = watch('resultEffect');

  // Precision only means something for the numeric types; showing it for TEXT
  // or DATE would offer a setting that changes nothing.
  const showsPrecision =
    dataType === 'CURRENCY' || dataType === 'DECIMAL' || dataType === 'PERCENT';

  return (
    <form
      onSubmit={handleSubmit((values) =>
        onSubmit({
          // A system column's key is omitted from the payload entirely rather
          // than sent unchanged, so the request cannot trip the server guard.
          ...(keyLocked ? {} : { key: values.key }),
          label: values.label,
          group: values.group.trim() === '' ? null : values.group,
          dataType: values.dataType,
          position: values.position === '' ? undefined : Number(values.position),
          precision: Number(values.precision),
          unit: values.unit.trim() === '' ? null : values.unit,
          isRequired: values.isRequired,
          isVisible: values.isVisible,
          includeInTotals: values.includeInTotals,
          resultEffect: values.resultEffect,
        }),
      )}
      className="contents"
      noValidate
    >
      <DialogHeader>
        <DialogTitle>{editing ? 'Ubah kolom' : 'Tambah kolom'}</DialogTitle>
        <DialogDescription>
          Kolom ini akan muncul di seluruh laporan Monthly.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="key">Key</Label>
            <Input
              id="key"
              placeholder="pl_bet"
              autoFocus={!keyLocked}
              disabled={keyLocked}
              className="font-mono lowercase"
              aria-invalid={errors.key ? true : undefined}
              {...register('key')}
            />
            {keyLocked ? (
              <p className="text-muted-foreground text-xs">
                Key kolom sistem tidak dapat diubah karena dirujuk oleh proses impor dan
                rumus.
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Pengenal tetap; dirujuk oleh impor Excel dan rumus.
              </p>
            )}
            {errors.key && (
              <p className="text-destructive text-sm">{errors.key.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="position">Posisi</Label>
            <Input
              id="position"
              inputMode="numeric"
              placeholder="Otomatis"
              aria-invalid={errors.position ? true : undefined}
              {...register('position')}
            />
            <p className="text-muted-foreground text-xs">
              Berjarak 10. Isi 15 untuk menyisipkan di antara 10 dan 20.
            </p>
            {errors.position && (
              <p className="text-destructive text-sm">{errors.position.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            placeholder="PL Bet"
            aria-invalid={errors.label ? true : undefined}
            {...register('label')}
          />
          {errors.label && (
            <p className="text-destructive text-sm">{errors.label.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="group">Grup</Label>
            <Input
              id="group"
              placeholder="Transaksi"
              aria-invalid={errors.group ? true : undefined}
              {...register('group')}
            />
            {errors.group && (
              <p className="text-destructive text-sm">{errors.group.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit">Satuan</Label>
            <Input
              id="unit"
              placeholder="Rp, %, org"
              aria-invalid={errors.unit ? true : undefined}
              {...register('unit')}
            />
            {errors.unit && (
              <p className="text-destructive text-sm">{errors.unit.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="dataType">Tipe data</Label>
            <Select
              items={DATA_TYPE_ITEMS}
              value={dataType}
              onValueChange={(value) =>
                setValue('dataType', value ?? 'CURRENCY', { shouldValidate: true })
              }
            >
              <SelectTrigger id="dataType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATA_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {DATA_TYPE_ITEMS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showsPrecision && (
            <div className="space-y-2">
              <Label htmlFor="precision">Presisi</Label>
              <Select
                items={PRECISION_ITEMS}
                value={precision}
                onValueChange={(value) =>
                  setValue('precision', value ?? '2', { shouldValidate: true })
                }
              >
                <SelectTrigger id="precision" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRECISION_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRECISION_ITEMS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <ToggleField
            label="Wajib diisi"
            description="Operator tidak dapat menyimpan laporan bila kolom ini kosong."
            checked={isRequired}
            onChange={(next) => setValue('isRequired', next, { shouldValidate: true })}
          />
          <ToggleField
            label="Tampilkan"
            description="Kolom tersembunyi tetap tersimpan, tetapi tidak muncul di tabel Monthly."
            checked={isVisible}
            onChange={(next) => setValue('isVisible', next, { shouldValidate: true })}
          />
          <ToggleField
            label="Ikut dijumlahkan"
            description="Sertakan kolom ini pada baris total dan rekap dashboard."
            checked={includeInTotals}
            onChange={(next) =>
              setValue('includeInTotals', next, { shouldValidate: true })
            }
          />
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="resultEffect">Perhitungan hasil</Label>
          <Select
            items={RESULT_EFFECT_LABELS}
            value={resultEffect}
            onValueChange={(value) =>
              setValue('resultEffect', (value as ResultEffectValue) ?? 'NEUTRAL', {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger id="resultEffect" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESULT_EFFECTS.map((effect) => (
                <SelectItem key={effect} value={effect}>
                  {RESULT_EFFECT_LABELS[effect]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {resultEffect === 'RESULT'
              ? 'Kolom ini dihitung otomatis dari kolom lain dan tidak dapat diisi manual. Hanya boleh ada satu kolom hasil.'
              : resultEffect === 'ADD'
                ? 'Nilai kolom ini ditambahkan ke kolom hasil.'
                : resultEffect === 'SUBTRACT'
                  ? 'Nilai kolom ini dikurangkan dari kolom hasil.'
                  : 'Kolom ini tetap tercatat, tetapi tidak ikut menghitung hasil.'}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {editing ? 'Simpan' : 'Buat kolom'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * There is no checkbox in `components/ui`, so this mirrors the inline checkbox
 * the user site-picker builds in `admin/users/users-client.tsx`.
 */
function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors',
        checked ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
          checked
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-input',
        )}
      >
        {checked && <Check className="size-3" />}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-xs">{description}</span>
      </span>
    </button>
  );
}
