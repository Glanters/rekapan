'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Loader2,
  Lock,
  MapPin,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

interface IpRule {
  id: string;
  cidr: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) throw new Error(payload.message);
  return payload.data as T;
}

const IP_KNOWN = (ip: string) => ip !== 'unknown' && ip.trim() !== '';

/**
 * Global IP allowlist manager.
 *
 * The list is a whitelist: while empty the feature is off and everyone gets in;
 * once it holds a rule, only matching addresses may use the app. The server
 * refuses any change that would drop the operator's own address from a non-empty
 * list, so the "add my IP" shortcut and the current-address banner are the
 * guard rails that keep that refusal from being a dead end.
 */
export function SecurityClient({
  canEdit,
  currentIp,
}: {
  canEdit: boolean;
  currentIp: string;
}) {
  const queryClient = useQueryClient();
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  const [pendingDelete, setPendingDelete] = useState<IpRule | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['ip-allowlist'],
    queryFn: () => callApi<IpRule[]>('/api/admin/security/ip-allowlist'),
  });

  const add = useMutation({
    mutationFn: (input: { cidr: string; label?: string }) =>
      callApi<IpRule[]>('/api/admin/security/ip-allowlist', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['ip-allowlist'], next);
      setCidr('');
      setLabel('');
      toast.success('Aturan IP ditambahkan.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      callApi<IpRule[]>(`/api/admin/security/ip-allowlist/${id}`, { method: 'DELETE' }),
    onSuccess: (next) => {
      queryClient.setQueryData(['ip-allowlist'], next);
      setPendingDelete(null);
      toast.success('Aturan IP dihapus.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const active = rules.length > 0;

  function submit() {
    const trimmed = cidr.trim();
    if (!trimmed) return;
    add.mutate({ cidr: trimmed, ...(label.trim() ? { label: label.trim() } : {}) });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pembatasan IP</h1>
          <p className="text-muted-foreground text-sm">
            Batasi akses aplikasi ke alamat IP tertentu. Berlaku setelah login.
          </p>
        </div>
        {!canEdit && (
          <Badge variant="outline" className="font-normal">
            <Lock className="size-3" />
            Hanya baca
          </Badge>
        )}
      </div>

      {/* Status + current address. */}
      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={
                active
                  ? 'flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full'
              }
            >
              {active ? (
                <ShieldCheck className="size-5" />
              ) : (
                <ShieldOff className="size-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{active ? 'Aktif' : 'Nonaktif'}</p>
              <p className="text-muted-foreground text-xs">
                {active
                  ? `Hanya ${rules.length} aturan IP yang boleh mengakses aplikasi.`
                  : 'Daftar kosong — semua alamat IP diizinkan.'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">IP Anda saat ini</p>
            <p className="font-mono text-sm">{currentIp}</p>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Tambah aturan</CardTitle>
            <CardDescription>
              Masukkan satu alamat IP (mis. <code>203.0.113.5</code>) atau rentang CIDR
              (mis. <code>203.0.113.0/24</code>). IPv4 dan IPv6 didukung.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="ip-cidr" className="text-xs">
                  IP atau CIDR
                </Label>
                <Input
                  id="ip-cidr"
                  value={cidr}
                  onChange={(event) => setCidr(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="203.0.113.0/24"
                  disabled={add.isPending}
                />
              </div>
              <div className="min-w-40 flex-1 space-y-1.5">
                <Label htmlFor="ip-label" className="text-xs">
                  Keterangan (opsional)
                </Label>
                <Input
                  id="ip-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Kantor Jakarta"
                  disabled={add.isPending}
                />
              </div>
              <Button onClick={submit} disabled={add.isPending || !cidr.trim()}>
                {add.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Tambah
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={add.isPending || !IP_KNOWN(currentIp)}
                onClick={() => setCidr(currentIp)}
                title={
                  IP_KNOWN(currentIp)
                    ? undefined
                    : 'Alamat IP Anda tidak terdeteksi (kemungkinan tanpa proxy di lingkungan ini).'
                }
              >
                <MapPin className="size-4" />
                Gunakan IP saya ({currentIp})
              </Button>
              {active && (
                <p className="text-muted-foreground text-xs">
                  Pastikan IP Anda tercakup agar tidak terkunci.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60 overflow-hidden py-0">
        <div className="divide-border/60 divide-y">
          {isLoading && (
            <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Memuat…
            </div>
          )}

          {!isLoading && rules.length === 0 && (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Belum ada aturan. Selama daftar kosong, semua alamat IP dapat mengakses
              aplikasi.
            </div>
          )}

          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-medium">{rule.cidr}</code>
                  {rule.label && (
                    <Badge variant="secondary" className="font-normal">
                      {rule.label}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Ditambahkan {format(new Date(rule.createdAt), 'dd/MM/yyyy HH:mm')}
                  {rule.createdBy ? ` · ${rule.createdBy}` : ''}
                </p>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Hapus aturan ${rule.cidr}`}
                  onClick={() => setPendingDelete(rule)}
                >
                  <Trash2 className="text-destructive size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus aturan IP</DialogTitle>
            <DialogDescription>
              <code>{pendingDelete?.cidr}</code> akan dihapus dari daftar. Pengguna pada
              alamat ini tidak akan bisa mengakses aplikasi lagi bila daftar tetap
              aktif.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={remove.isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
