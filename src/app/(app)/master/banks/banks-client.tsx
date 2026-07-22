'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Info,
  Landmark,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
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

/**
 * Bank master data.
 *
 * Each row here is a COLUMN of the per-bank validation breakdown, not a record
 * inside it. `MonthlyValidation` pairs a report with a bank and holds the head
 * count of members who registered through that bank that day, so adding a bank
 * adds a column to that breakdown on every Monthly report at once, ordered by
 * `position`. Deactivating one removes the column without touching the counts
 * already recorded against it.
 */

interface BankRow {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
  position: number;
  isActive: boolean;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

interface BanksClientProps {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const BankFormSchema = z.object({
  code: z
    .string()
    .min(2, 'Kode minimal 2 karakter.')
    .max(32, 'Kode maksimal 32 karakter.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh berisi huruf, angka, - dan _.'),
  name: z.string().min(1, 'Nama wajib diisi.').max(128, 'Nama maksimal 128 karakter.'),
  logoUrl: z.string().max(512, 'URL logo maksimal 512 karakter.'),
  // Kept as text so an empty box means "letakkan di akhir" rather than NaN; the
  // submit handler converts it.
  position: z
    .string()
    .regex(/^\d*$/, 'Posisi harus berupa angka.')
    .refine(
      (value) => value === '' || Number(value) <= 100_000,
      'Posisi terlalu besar.',
    ),
  isActive: z.boolean(),
});

type BankFormValues = z.infer<typeof BankFormSchema>;

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) throw new Error(payload.message);
  return payload.data as T;
}

type FormState = { mode: 'create' } | { mode: 'edit'; bank: BankRow };

export function BanksClient({ canCreate, canUpdate, canDelete }: BanksClientProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [formState, setFormState] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BankRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['master-banks'],
    // Inactive banks are part of what this screen manages, so it asks for them
    // explicitly — unlike the validation breakdown, which only renders live
    // columns.
    queryFn: () =>
      callApi<{ banks: BankRow[] }>('/api/master/banks?includeInactive=true'),
  });

  const mutate = useMutation({
    mutationFn: (input: { url: string; method: string; body?: unknown }) =>
      callApi<BankRow>(input.url, {
        method: input.method,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      }),
    onSuccess: (_bank, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['master-banks'] });
      setFormState(null);
      setPendingDelete(null);
      toast.success(
        variables.method === 'POST'
          ? 'Bank dibuat.'
          : variables.method === 'DELETE'
            ? 'Bank dihapus.'
            : 'Bank diperbarui.',
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const banks = data?.banks ?? [];

  const term = search.trim().toLowerCase();
  const filtered = term
    ? banks.filter(
        (bank) =>
          bank.code.toLowerCase().includes(term) ||
          bank.name.toLowerCase().includes(term),
      )
    : banks;

  const activeCount = banks.filter((bank) => bank.isActive).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bank</h1>
          <p className="text-muted-foreground text-sm">
            Daftar bank yang menjadi rincian di balik angka Validasi.
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode atau nama…"
              className="pl-9"
            />
          </div>
          {canCreate && (
            <Button onClick={() => setFormState({ mode: 'create' })}>
              <Plus className="size-4" />
              Tambah bank
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border/60 bg-muted/30">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-sm">
            Setiap bank adalah satu kolom pada rincian per bank di balik angka{' '}
            <span className="font-medium">Validasi</span> di Monthly — yaitu jumlah
            member yang melakukan registrasi pada hari itu, dihitung per kepala, bukan
            nominal. Urutan kolom mengikuti nilai{' '}
            <span className="font-medium">posisi</span>.{' '}
            <span className="text-foreground font-medium">
              {activeCount} bank aktif
            </span>{' '}
            saat ini tampil di rincian.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/60 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">Posisi</TableHead>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Logo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-12 text-center"
                  >
                    <Landmark className="mx-auto mb-2 size-8 opacity-40" />
                    {banks.length === 0
                      ? 'Belum ada bank.'
                      : 'Tidak ada bank yang cocok.'}
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((bank) => (
                <TableRow key={bank.id} className={cn(!bank.isActive && 'opacity-60')}>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {bank.position}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">
                    {bank.code}
                  </TableCell>
                  <TableCell className="font-medium">{bank.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-56 truncate text-xs">
                    {bank.logoUrl ?? '—'}
                  </TableCell>
                  <TableCell>
                    {bank.isActive ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/25 bg-emerald-500/15 font-normal text-emerald-700 dark:text-emerald-400"
                      >
                        Aktif
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground font-normal"
                      >
                        Nonaktif
                      </Badge>
                    )}
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
                        <DropdownMenuContent align="end" className="w-44">
                          {canUpdate && (
                            <DropdownMenuItem
                              onClick={() => setFormState({ mode: 'edit', bank })}
                            >
                              <Pencil className="size-4" />
                              Ubah
                            </DropdownMenuItem>
                          )}
                          {canUpdate && (
                            <DropdownMenuItem
                              onClick={() =>
                                mutate.mutate({
                                  url: `/api/master/banks/${bank.id}`,
                                  method: 'PATCH',
                                  body: { isActive: !bank.isActive },
                                })
                              }
                            >
                              <Check className="size-4" />
                              {bank.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setPendingDelete(bank)}
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
        <DialogContent className="sm:max-w-md">
          {formState && (
            <BankForm
              key={formState.mode === 'edit' ? formState.bank.id : 'new'}
              state={formState}
              busy={mutate.isPending}
              onCancel={() => setFormState(null)}
              onSubmit={(values) =>
                mutate.mutate(
                  formState.mode === 'create'
                    ? { url: '/api/master/banks', method: 'POST', body: values }
                    : {
                        url: `/api/master/banks/${formState.bank.id}`,
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
            <DialogTitle>Hapus bank</DialogTitle>
            <DialogDescription>
              Kolom <span className="font-medium">{pendingDelete?.name}</span> akan
              hilang dari rincian Validasi. Bank yang sudah memiliki data validasi tidak
              dapat dihapus — nonaktifkan bank tersebut agar riwayat registrasinya tetap
              tersimpan dan tetap terbaca.
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
                  url: `/api/master/banks/${pendingDelete.id}`,
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

interface BankPayload {
  code: string;
  name: string;
  logoUrl: string | null;
  position?: number | undefined;
  isActive: boolean;
}

function BankForm({
  state,
  busy,
  onCancel,
  onSubmit,
}: {
  state: FormState;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: BankPayload) => void;
}) {
  const editing = state.mode === 'edit' ? state.bank : null;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BankFormValues>({
    resolver: zodResolver(BankFormSchema),
    defaultValues: {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      logoUrl: editing?.logoUrl ?? '',
      position: editing ? String(editing.position) : '',
      isActive: editing?.isActive ?? true,
    },
  });

  const isActive = watch('isActive');

  return (
    <form
      onSubmit={handleSubmit((values) =>
        onSubmit({
          code: values.code,
          name: values.name,
          logoUrl: values.logoUrl.trim() === '' ? null : values.logoUrl,
          // An empty box means "put it at the end"; the service picks the next
          // free slot rather than the client guessing one.
          position: values.position === '' ? undefined : Number(values.position),
          isActive: values.isActive,
        }),
      )}
      className="contents"
      noValidate
    >
      <DialogHeader>
        <DialogTitle>{editing ? 'Ubah bank' : 'Tambah bank'}</DialogTitle>
        <DialogDescription>
          Bank ini akan menjadi satu kolom pada rincian Validasi.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="code">Kode</Label>
            <Input
              id="code"
              placeholder="BCA"
              autoFocus
              className="font-mono uppercase"
              aria-invalid={errors.code ? true : undefined}
              {...register('code')}
            />
            {errors.code && (
              <p className="text-destructive text-sm">{errors.code.message}</p>
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
            {errors.position && (
              <p className="text-destructive text-sm">{errors.position.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Nama</Label>
          <Input
            id="name"
            placeholder="Bank Central Asia"
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name && (
            <p className="text-destructive text-sm">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="logoUrl">URL logo</Label>
          <Input
            id="logoUrl"
            placeholder="/logos/bca.png"
            aria-invalid={errors.logoUrl ? true : undefined}
            {...register('logoUrl')}
          />
          <p className="text-muted-foreground text-xs">
            Boleh berupa alamat lengkap maupun path di dalam aplikasi. Kosongkan bila
            tidak perlu.
          </p>
          {errors.logoUrl && (
            <p className="text-destructive text-sm">{errors.logoUrl.message}</p>
          )}
        </div>

        <ToggleField
          label="Aktif"
          description="Bank nonaktif tidak ditampilkan sebagai kolom pada rincian Validasi."
          checked={isActive}
          onChange={(next) => setValue('isActive', next, { shouldValidate: true })}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {editing ? 'Simpan' : 'Buat bank'}
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
