'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Lock, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  level: number;
  isSystem: boolean;
  userCount: number;
  permissionKeys: string[];
  editable: boolean;
  renamable: boolean;
}

interface PermissionView {
  key: string;
  action: string;
  description: string;
}

interface ModuleView {
  module: string;
  permissions: PermissionView[];
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

const RenameSchema = z.object({
  name: z.string().min(1, 'Nama role wajib diisi.').max(128, 'Nama terlalu panjang.'),
  description: z.string().max(2000, 'Deskripsi terlalu panjang.'),
});

type RenameValues = z.infer<typeof RenameSchema>;

/**
 * Role editor.
 *
 * Edits are collected locally and committed with one explicit save rather than
 * firing a request per checkbox. Two reasons: a permission set is a decision
 * made as a whole, and every write is an audited transaction — one deliberate
 * save produces one honest audit entry instead of thirty noisy ones.
 *
 * Which roles are editable is decided by the server (`editable` / `renamable`
 * per role); this component only reflects that. Disabling a checkbox is a
 * convenience, not the guard.
 */
export function RolesClient({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, Set<string>>>({});
  const [renaming, setRenaming] = useState<RoleView | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () =>
      callApi<{ roles: RoleView[]; modules: ModuleView[] }>('/api/admin/roles'),
  });

  const roles = data?.roles ?? [];
  const modules = data?.modules ?? [];
  const permissionCount = modules.reduce(
    (sum, module) => sum + module.permissions.length,
    0,
  );

  function effectiveKeys(role: RoleView): Set<string> {
    return overrides[role.id] ?? new Set(role.permissionKeys);
  }

  function isDirty(role: RoleView): boolean {
    const override = overrides[role.id];
    if (!override) return false;
    if (override.size !== role.permissionKeys.length) return true;
    return role.permissionKeys.some((key) => !override.has(key));
  }

  const dirtyRoles = roles.filter(isDirty);

  const save = useMutation({
    mutationFn: async (targets: RoleView[]) => {
      // Sequential on purpose: each role is its own audited transaction, and if
      // one is refused the remaining ones should not have already been applied.
      for (const role of targets) {
        await callApi(`/api/admin/roles/${role.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'setPermissions',
            permissionKeys: [...effectiveKeys(role)],
          }),
        });
      }
    },
    onSuccess: () => {
      setOverrides({});
      void queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      toast.success('Perubahan izin disimpan.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rename = useMutation({
    mutationFn: async (input: { roleId: string; values: RenameValues }) =>
      callApi<RoleView>(`/api/admin/roles/${input.roleId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'updateDetails',
          name: input.values.name,
          description: input.values.description.trim() || null,
        }),
      }),
    onSuccess: () => {
      setRenaming(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
      toast.success('Role diperbarui.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggle(role: RoleView, permissionKey: string) {
    setOverrides((previous) => {
      const current = previous[role.id] ?? new Set(role.permissionKeys);
      const next = new Set(current);
      if (next.has(permissionKey)) next.delete(permissionKey);
      else next.add(permissionKey);
      return { ...previous, [role.id]: next };
    });
  }

  function toggleModule(role: RoleView, module: ModuleView) {
    setOverrides((previous) => {
      const current = previous[role.id] ?? new Set(role.permissionKeys);
      const next = new Set(current);
      const allHeld = module.permissions.every((permission) =>
        next.has(permission.key),
      );
      for (const permission of module.permissions) {
        if (allHeld) next.delete(permission.key);
        else next.add(permission.key);
      }
      return { ...previous, [role.id]: next };
    });
  }

  const busy = save.isPending || rename.isPending;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Role</h1>
          <p className="text-muted-foreground text-sm">
            {permissionCount > 0
              ? `Matriks ${permissionCount} izin untuk ${roles.length} role.`
              : 'Matriks izin untuk setiap role.'}
          </p>
        </div>
        {!canEdit && (
          <Badge variant="outline" className="font-normal">
            <Lock className="size-3" />
            Hanya baca
          </Badge>
        )}
      </div>

      {isLoading && (
        <Card className="border-border/60">
          <CardContent className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {!isLoading && (
        <Card className="border-border/60 overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border/60 border-b">
                  <th className="bg-card sticky left-0 z-10 min-w-64 px-4 py-3 text-left font-medium">
                    Izin
                  </th>
                  {roles.map((role) => (
                    <th
                      key={role.id}
                      className="min-w-32 px-3 py-3 text-center align-bottom"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className="flex items-center gap-1 font-medium">
                          {role.name}
                          {!role.editable && (
                            <Lock
                              className="text-muted-foreground size-3"
                              aria-label="Terkunci"
                            />
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs font-normal">
                          {role.userCount} pengguna
                        </span>
                        {role.renamable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setRenaming(role)}
                            disabled={busy}
                          >
                            <Pencil className="size-3" />
                            Ubah nama
                          </Button>
                        )}
                        {role.isSystem && (
                          <span className="text-muted-foreground text-[10px] font-normal">
                            Role sistem
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {modules.map((module) => (
                  <ModuleRows
                    key={module.module}
                    module={module}
                    roles={roles}
                    effectiveKeys={effectiveKeys}
                    canEdit={canEdit}
                    busy={busy}
                    onToggle={toggle}
                    onToggleModule={toggleModule}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dirtyRoles.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
          <Card className="border-primary/40 bg-card mx-auto max-w-3xl shadow-lg">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1">
              <p className="text-sm">
                <span className="font-medium">{dirtyRoles.length} role diubah</span>{' '}
                <span className="text-muted-foreground">
                  ({dirtyRoles.map((role) => role.name).join(', ')})
                </span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOverrides({})}
                  disabled={busy}
                >
                  <RotateCcw className="size-4" />
                  Batalkan
                </Button>
                <Button
                  size="sm"
                  onClick={() => save.mutate(dirtyRoles)}
                  disabled={busy}
                >
                  {save.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Simpan perubahan
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <RenameDialog
        role={renaming}
        busy={rename.isPending}
        onClose={() => setRenaming(null)}
        onSave={(values) => renaming && rename.mutate({ roleId: renaming.id, values })}
      />
    </div>
  );
}

function ModuleRows({
  module,
  roles,
  effectiveKeys,
  canEdit,
  busy,
  onToggle,
  onToggleModule,
}: {
  module: ModuleView;
  roles: RoleView[];
  effectiveKeys: (role: RoleView) => Set<string>;
  canEdit: boolean;
  busy: boolean;
  onToggle: (role: RoleView, permissionKey: string) => void;
  onToggleModule: (role: RoleView, module: ModuleView) => void;
}) {
  return (
    <>
      <tr className="bg-muted/40 border-border/60 border-b">
        <th className="bg-muted/40 sticky left-0 z-10 px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase">
          {module.module}
        </th>
        {roles.map((role) => {
          const held = effectiveKeys(role);
          const count = module.permissions.filter((permission) =>
            held.has(permission.key),
          ).length;
          const editable = canEdit && role.editable;

          return (
            <td key={role.id} className="px-3 py-2 text-center">
              <button
                type="button"
                disabled={!editable || busy}
                onClick={() => onToggleModule(role, module)}
                className={cn(
                  'text-muted-foreground rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                  editable && !busy
                    ? 'hover:bg-background hover:text-foreground'
                    : 'cursor-default',
                )}
                title={editable ? 'Pilih atau kosongkan seluruh modul' : undefined}
              >
                {count}/{module.permissions.length}
              </button>
            </td>
          );
        })}
      </tr>

      {module.permissions.map((permission) => (
        <tr
          key={permission.key}
          className="border-border/60 hover:bg-muted/20 border-b"
        >
          <th className="bg-card sticky left-0 z-10 px-4 py-2 text-left font-normal">
            <span className="block text-sm">{permission.action}</span>
            <span className="text-muted-foreground block font-mono text-xs">
              {permission.key}
            </span>
          </th>

          {roles.map((role) => {
            const held = effectiveKeys(role).has(permission.key);
            const editable = canEdit && role.editable;

            return (
              <td key={role.id} className="px-3 py-2 text-center">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={held}
                  aria-label={`${permission.key} untuk ${role.name}`}
                  disabled={!editable || busy}
                  onClick={() => onToggle(role, permission.key)}
                  className={cn(
                    'inline-flex size-5 items-center justify-center rounded border transition-colors',
                    held
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-input',
                    editable && !busy
                      ? 'hover:border-primary cursor-pointer'
                      : 'cursor-not-allowed opacity-60',
                  )}
                >
                  {held && <Check className="size-3.5" />}
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RenameDialog({
  role,
  busy,
  onClose,
  onSave,
}: {
  role: RoleView | null;
  busy: boolean;
  onClose: () => void;
  onSave: (values: RenameValues) => void;
}) {
  return (
    <Dialog
      open={role !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {/* Keyed by role, so opening the dialog for a different role remounts
            the form with that role's values rather than needing a reset. */}
        {role && (
          <RenameForm
            key={role.id}
            role={role}
            busy={busy}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  role,
  busy,
  onClose,
  onSave,
}: {
  role: RoleView;
  busy: boolean;
  onClose: () => void;
  onSave: (values: RenameValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RenameValues>({
    resolver: zodResolver(RenameSchema),
    defaultValues: { name: role.name, description: role.description ?? '' },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} noValidate>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          Ubah role
        </DialogTitle>
        <DialogDescription>
          Kunci role ({role.key}) tidak dapat diubah karena menjadi acuan kode.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="role-name">Nama</Label>
          <Input
            id="role-name"
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name && (
            <p className="text-destructive text-sm">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="role-description">Deskripsi</Label>
          <Textarea id="role-description" rows={3} {...register('description')} />
          {errors.description && (
            <p className="text-destructive text-sm">{errors.description.message}</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Simpan
        </Button>
      </DialogFooter>
    </form>
  );
}
