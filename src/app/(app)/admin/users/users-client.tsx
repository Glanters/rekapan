'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  CircleSlash,
  Loader2,
  MoreHorizontal,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
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

interface SiteRef {
  id: string;
  code: string;
  name: string;
}

interface RoleRef {
  id: string;
  key: string;
  name: string;
  level: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  lastLoginAt: string | null;
  role: RoleRef | null;
  sites: { site: SiteRef }[];
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

interface UsersClientProps {
  assignableSites: SiteRef[];
  canActivate: boolean;
  canSuspend: boolean;
  canAssignSites: boolean;
  canChangeRole: boolean;
  currentUserId: string;
}

const STATUS_STYLES: Record<UserRow['status'], { label: string; className: string }> = {
  PENDING: {
    label: 'Menunggu aktivasi',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  },
  ACTIVE: {
    label: 'Aktif',
    className:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  SUSPENDED: {
    label: 'Ditangguhkan',
    className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
  },
  INACTIVE: { label: 'Nonaktif', className: 'text-muted-foreground' },
};

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) throw new Error(payload.message);
  return payload.data as T;
}

export function UsersClient({
  assignableSites,
  canActivate,
  canSuspend,
  canAssignSites,
  canChangeRole,
  currentUserId,
}: UsersClientProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [siteDialogUser, setSiteDialogUser] = useState<UserRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => callApi<{ users: UserRow[]; roles: RoleRef[] }>('/api/admin/users'),
  });

  const mutate = useMutation({
    mutationFn: async (input: { url: string; method: string; body: unknown }) =>
      callApi<UserRow>(input.url, {
        method: input.method,
        body: JSON.stringify(input.body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSiteDialogUser(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const users = data?.users ?? [];
  const roles = data?.roles ?? [];

  const term = search.trim().toLowerCase();
  const filtered = term
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(term) || u.name.toLowerCase().includes(term),
      )
    : users;

  const pendingCount = users.filter((u) => u.status === 'PENDING').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengguna</h1>
          <p className="text-muted-foreground text-sm">
            Setujui akun baru dan atur akses site.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau email…"
            className="pl-9"
          />
        </div>
      </div>

      {pendingCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <UserCheck className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm">
              <span className="font-medium">
                {pendingCount} akun menunggu aktivasi.
              </span>{' '}
              <span className="text-muted-foreground">
                Mereka sudah terverifikasi di Account Center, tetapi belum bisa masuk
                sampai disetujui dan diberi akses site.
              </span>
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Pengguna</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Site</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground py-12 text-center"
                  >
                    Tidak ada pengguna yang cocok.
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((user) => {
                const status = STATUS_STYLES[user.status];
                const isSelf = user.id === currentUserId;

                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {user.name}
                          {isSelf && (
                            <span className="text-muted-foreground ml-2 text-xs font-normal">
                              (Anda)
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {user.email}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn('font-normal', status.className)}
                      >
                        {status.label}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-sm">
                      {user.role?.name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {user.role?.key === 'ROOT' ? (
                        <span className="text-muted-foreground text-sm">
                          Semua site
                        </span>
                      ) : user.sites.length === 0 ? (
                        <span className="text-muted-foreground text-sm">Belum ada</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {user.sites.slice(0, 3).map(({ site }) => (
                            <Badge
                              key={site.id}
                              variant="secondary"
                              className="font-normal"
                            >
                              {site.code}
                            </Badge>
                          ))}
                          {user.sites.length > 3 && (
                            <Badge variant="secondary" className="font-normal">
                              +{user.sites.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <RowActions
                        user={user}
                        roles={roles}
                        isSelf={isSelf}
                        canActivate={canActivate}
                        canSuspend={canSuspend}
                        canAssignSites={canAssignSites}
                        canChangeRole={canChangeRole}
                        busy={mutate.isPending}
                        onActivate={() =>
                          mutate.mutate({
                            url: `/api/admin/users/${user.id}`,
                            method: 'PATCH',
                            body: { action: 'activate' },
                          })
                        }
                        onSetStatus={(status) =>
                          mutate.mutate({
                            url: `/api/admin/users/${user.id}`,
                            method: 'PATCH',
                            body: { action: 'setStatus', status },
                          })
                        }
                        onSetRole={(roleId) =>
                          mutate.mutate({
                            url: `/api/admin/users/${user.id}`,
                            method: 'PATCH',
                            body: { action: 'setRole', roleId },
                          })
                        }
                        onManageSites={() => setSiteDialogUser(user)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <SiteDialog
        user={siteDialogUser}
        sites={assignableSites}
        busy={mutate.isPending}
        onClose={() => setSiteDialogUser(null)}
        onSave={(siteIds) =>
          siteDialogUser &&
          mutate.mutate({
            url: `/api/admin/users/${siteDialogUser.id}/sites`,
            method: 'PUT',
            body: { siteIds },
          })
        }
      />
    </div>
  );
}

function RowActions({
  user,
  roles,
  isSelf,
  canActivate,
  canSuspend,
  canAssignSites,
  canChangeRole,
  busy,
  onActivate,
  onSetStatus,
  onSetRole,
  onManageSites,
}: {
  user: UserRow;
  roles: RoleRef[];
  isSelf: boolean;
  canActivate: boolean;
  canSuspend: boolean;
  canAssignSites: boolean;
  canChangeRole: boolean;
  busy: boolean;
  onActivate: () => void;
  onSetStatus: (status: 'ACTIVE' | 'SUSPENDED') => void;
  onSetRole: (roleId: string) => void;
  onManageSites: () => void;
}) {
  // Roles the caller may grant are decided by the server; anything outside that
  // list is filtered out here too so an unusable option is never rendered.
  const grantable = roles.filter((r) => r.id !== user.role?.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Aksi" disabled={busy} />
        }
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {user.status === 'PENDING' && canActivate && (
          <DropdownMenuItem onClick={onActivate}>
            <Check className="size-4" />
            Aktifkan akun
          </DropdownMenuItem>
        )}

        {canAssignSites && user.role?.key !== 'ROOT' && (
          <DropdownMenuItem onClick={onManageSites}>
            <Building2 className="size-4" />
            Atur akses site
          </DropdownMenuItem>
        )}

        {canChangeRole && !isSelf && grantable.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Ubah role
            </DropdownMenuLabel>
            {grantable.map((role) => (
              <DropdownMenuItem key={role.id} onClick={() => onSetRole(role.id)}>
                <ShieldCheck className="size-4" />
                {role.name}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {canSuspend && !isSelf && user.status !== 'PENDING' && (
          <>
            <DropdownMenuSeparator />
            {user.status === 'ACTIVE' ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onSetStatus('SUSPENDED')}
              >
                <CircleSlash className="size-4" />
                Tangguhkan
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onSetStatus('ACTIVE')}>
                <Check className="size-4" />
                Aktifkan kembali
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SiteDialog({
  user,
  sites,
  busy,
  onClose,
  onSave,
}: {
  user: UserRow | null;
  sites: SiteRef[];
  busy: boolean;
  onClose: () => void;
  onSave: (siteIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  // Seed the checkboxes from the user being edited, once per dialog opening.
  if (user && initialisedFor !== user.id) {
    setInitialisedFor(user.id);
    setSelected(new Set(user.sites.map((s) => s.site.id)));
  }

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          setInitialisedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Akses site</DialogTitle>
          <DialogDescription>
            {user?.name} hanya akan melihat data dari site yang dipilih.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {sites.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Anda belum memiliki site yang dapat ditugaskan.
            </p>
          )}
          {sites.map((site) => {
            const checked = selected.has(site.id);
            return (
              <button
                key={site.id}
                type="button"
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(site.id)) next.delete(site.id);
                    else next.add(site.id);
                    return next;
                  })
                }
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  checked ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    checked
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-input',
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
                <span className="flex-1 truncate">{site.name}</span>
                <span className="text-muted-foreground text-xs">{site.code}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => onSave([...selected])} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
