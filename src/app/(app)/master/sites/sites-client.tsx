'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
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
import { cn } from '@/lib/utils';

type SiteStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

interface SiteRow {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currency: string;
  status: SiteStatus;
  templateId: string | null;
  template: { code: string; name: string } | null;
}

interface TemplateOption {
  id: string;
  code: string;
  name: string;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

interface SitesClientProps {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const STATUS_STYLES: Record<SiteStatus, { label: string; className: string }> = {
  ACTIVE: {
    label: 'Aktif',
    className:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  INACTIVE: {
    label: 'Nonaktif',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  },
  ARCHIVED: { label: 'Diarsipkan', className: 'text-muted-foreground' },
};

const STATUS_ITEMS: Record<string, string> = {
  ACTIVE: 'Aktif',
  INACTIVE: 'Nonaktif',
  ARCHIVED: 'Diarsipkan',
};

/**
 * Offered as a list rather than free text so an operator cannot save a zone the
 * date formatter will later fail to resolve. These are the zones Indonesia
 * actually spans, plus UTC for reporting.
 */
const TIMEZONE_ITEMS: Record<string, string> = {
  'Asia/Jakarta': 'Asia/Jakarta (WIB)',
  'Asia/Makassar': 'Asia/Makassar (WITA)',
  'Asia/Jayapura': 'Asia/Jayapura (WIT)',
  UTC: 'UTC',
};

const SiteFormSchema = z.object({
  code: z
    .string()
    .min(2, 'Kode minimal 2 karakter.')
    .max(32, 'Kode maksimal 32 karakter.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh berisi huruf, angka, - dan _.'),
  name: z.string().min(1, 'Nama wajib diisi.').max(191, 'Nama maksimal 191 karakter.'),
  timezone: z.string().min(1, 'Zona waktu wajib diisi.'),
  currency: z
    .string()
    .min(3, 'Mata uang minimal 3 karakter.')
    .max(8, 'Mata uang maksimal 8 karakter.'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
  templateId: z.string().min(1, 'Template wajib dipilih.'),
});

type SiteFormValues = z.infer<typeof SiteFormSchema>;

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) throw new Error(payload.message);
  return payload.data as T;
}

type FormState = { mode: 'create' } | { mode: 'edit'; site: SiteRow };

export function SitesClient({ canCreate, canUpdate, canDelete }: SitesClientProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [formState, setFormState] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['master-sites'],
    queryFn: () =>
      callApi<{ sites: SiteRow[]; templates: TemplateOption[] }>('/api/master/sites'),
  });

  const mutate = useMutation({
    mutationFn: (input: { url: string; method: string; body?: unknown }) =>
      callApi<SiteRow>(input.url, {
        method: input.method,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      }),
    onSuccess: (_site, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['master-sites'] });
      setFormState(null);
      setPendingDelete(null);
      toast.success(
        variables.method === 'POST'
          ? 'Site dibuat.'
          : variables.method === 'DELETE'
            ? 'Site dihapus.'
            : 'Site diperbarui.',
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sites = data?.sites ?? [];
  const templates = data?.templates ?? [];

  const term = search.trim().toLowerCase();
  const filtered = term
    ? sites.filter(
        (site) =>
          site.code.toLowerCase().includes(term) ||
          site.name.toLowerCase().includes(term),
      )
    : sites;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Site</h1>
          <p className="text-muted-foreground text-sm">
            Kelola daftar site beserta zona waktu dan mata uangnya.
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
              Tambah site
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border/60 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Zona waktu</TableHead>
                <TableHead>Mata uang</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
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
                    <Building2 className="mx-auto mb-2 size-8 opacity-40" />
                    {sites.length === 0
                      ? 'Belum ada site.'
                      : 'Tidak ada site yang cocok.'}
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((site) => {
                const status = STATUS_STYLES[site.status];

                return (
                  <TableRow key={site.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {site.code}
                    </TableCell>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {site.timezone}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {site.currency}
                    </TableCell>
                    <TableCell>
                      {site.template ? (
                        <Badge variant="secondary" className="font-normal">
                          {site.template.code}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn('font-normal', status.className)}
                      >
                        {status.label}
                      </Badge>
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
                                onClick={() => setFormState({ mode: 'edit', site })}
                              >
                                <Pencil className="size-4" />
                                Ubah
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setPendingDelete(site)}
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
                );
              })}
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
            // Keyed so switching rows remounts the form with fresh defaults
            // rather than carrying the previous site's values across.
            <SiteForm
              key={formState.mode === 'edit' ? formState.site.id : 'new'}
              state={formState}
              templates={templates}
              busy={mutate.isPending}
              onCancel={() => setFormState(null)}
              onSubmit={(values) =>
                mutate.mutate(
                  formState.mode === 'create'
                    ? { url: '/api/master/sites', method: 'POST', body: values }
                    : {
                        url: `/api/master/sites/${formState.site.id}`,
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
            <DialogTitle>Hapus site</DialogTitle>
            <DialogDescription>
              Site <span className="font-medium">{pendingDelete?.name}</span> akan
              disembunyikan dari seluruh aplikasi. Laporan dan gambar yang sudah
              tercatat tetap tersimpan dan dapat dipulihkan oleh administrator.
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
                  url: `/api/master/sites/${pendingDelete.id}`,
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

function SiteForm({
  state,
  templates,
  busy,
  onCancel,
  onSubmit,
}: {
  state: FormState;
  templates: TemplateOption[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: SiteFormValues) => void;
}) {
  const editing = state.mode === 'edit' ? state.site : null;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SiteFormValues>({
    resolver: zodResolver(SiteFormSchema),
    defaultValues: {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      timezone: editing?.timezone ?? 'Asia/Jakarta',
      currency: editing?.currency ?? 'IDR',
      status: editing?.status ?? 'ACTIVE',
      templateId: editing?.templateId ?? templates[0]?.id ?? '',
    },
  });

  const timezone = watch('timezone');
  const status = watch('status');
  const templateId = watch('templateId');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>{editing ? 'Ubah site' : 'Tambah site'}</DialogTitle>
        <DialogDescription>
          Kode dipakai sebagai kunci pencocokan saat mengimpor data dari Excel.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="code">Kode</Label>
            <Input
              id="code"
              placeholder="JKT"
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
            <Label htmlFor="currency">Mata uang</Label>
            <Input
              id="currency"
              placeholder="IDR"
              className="uppercase"
              aria-invalid={errors.currency ? true : undefined}
              {...register('currency')}
            />
            {errors.currency && (
              <p className="text-destructive text-sm">{errors.currency.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Nama</Label>
          <Input
            id="name"
            placeholder="Jakarta"
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name && (
            <p className="text-destructive text-sm">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="timezone">Zona waktu</Label>
          <Select
            items={TIMEZONE_ITEMS}
            value={timezone}
            onValueChange={(value) =>
              setValue('timezone', value ?? 'Asia/Jakarta', { shouldValidate: true })
            }
          >
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TIMEZONE_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            items={STATUS_ITEMS}
            value={status}
            onValueChange={(value) =>
              setValue('status', value ?? 'ACTIVE', { shouldValidate: true })
            }
          >
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_ITEMS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="template">Template Monthly</Label>
          <Select
            items={Object.fromEntries(templates.map((t) => [t.id, t.name]))}
            value={templateId}
            onValueChange={(value) =>
              setValue('templateId', value ?? '', { shouldValidate: true })
            }
          >
            <SelectTrigger id="template" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.templateId && (
            <p className="text-destructive text-sm">{errors.templateId.message}</p>
          )}
          <p className="text-muted-foreground text-xs">
            Menentukan kumpulan kolom laporan Monthly untuk site ini.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {editing ? 'Simpan' : 'Buat site'}
        </Button>
      </DialogFooter>
    </form>
  );
}
