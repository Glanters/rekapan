'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Lock, RotateCcw } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

type SettingValue = string | number;

interface SelectDefinition {
  key: string;
  type: 'select';
  label: string;
  description: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}

interface NumberDefinition {
  key: string;
  type: 'number';
  label: string;
  description: string;
  defaultValue: number;
  min: number;
  max: number;
}

type SettingDefinition = SelectDefinition | NumberDefinition;

interface SettingView {
  key: string;
  value: SettingValue;
  isDefault: boolean;
  updatedAt: string | null;
}

interface SettingsPayload {
  settings: SettingView[];
  definitions: SettingDefinition[];
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

/**
 * Application settings.
 *
 * Only the keys the server declares are rendered, and only the ones it returns —
 * secret settings never reach this component, so there is no client-side filter
 * here that could be got wrong. Edits are staged locally and committed as one
 * batch, which is also what makes the audit entry a single readable diff.
 */
export function SettingsClient({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => callApi<SettingsPayload>('/api/admin/settings'),
  });

  const definitions = data?.definitions ?? [];
  const settings = data?.settings ?? [];
  const currentByKey = new Map(settings.map((setting) => [setting.key, setting]));

  function currentValue(key: string, fallback: SettingValue): SettingValue {
    return currentByKey.get(key)?.value ?? fallback;
  }

  function effectiveValue(definition: SettingDefinition): SettingValue {
    return (
      draft[definition.key] ?? currentValue(definition.key, definition.defaultValue)
    );
  }

  const changed = definitions.filter((definition) => {
    const staged = draft[definition.key];
    if (staged === undefined) return false;
    return staged !== currentValue(definition.key, definition.defaultValue);
  });

  const save = useMutation({
    mutationFn: async () => {
      const values: Record<string, SettingValue> = {};
      for (const definition of changed) {
        values[definition.key] = effectiveValue(definition);
      }
      return callApi<SettingsPayload>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ values }),
      });
    },
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Pengaturan disimpan.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengaturan</h1>
          <p className="text-muted-foreground text-sm">
            Nilai default untuk seluruh aplikasi. Site dapat menimpanya sendiri.
          </p>
        </div>
        {!canEdit && (
          <Badge variant="outline" className="font-normal">
            <Lock className="size-3" />
            Hanya baca
          </Badge>
        )}
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Umum</CardTitle>
          <CardDescription>
            Berlaku global. Pengaturan rahasia tidak ditampilkan di sini.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {isLoading &&
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}

          {!isLoading && definitions.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Tidak ada pengaturan yang dapat ditampilkan.
            </p>
          )}

          {!isLoading &&
            definitions.map((definition, index) => {
              const value = effectiveValue(definition);
              const setting = currentByKey.get(definition.key);
              const isModified = changed.some((entry) => entry.key === definition.key);

              return (
                <div key={definition.key} className="space-y-2">
                  {index > 0 && <Separator className="mb-6" />}

                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={definition.key}>{definition.label}</Label>
                    {setting?.isDefault && !isModified && (
                      <Badge variant="secondary" className="font-normal">
                        Default
                      </Badge>
                    )}
                    {isModified && (
                      <Badge variant="outline" className="font-normal">
                        Belum disimpan
                      </Badge>
                    )}
                  </div>

                  <p className="text-muted-foreground text-xs">
                    {definition.description}
                  </p>

                  {definition.type === 'select' ? (
                    <Select
                      items={definition.options}
                      value={String(value)}
                      onValueChange={(next) =>
                        setDraft((previous) => ({
                          ...previous,
                          [definition.key]:
                            typeof next === 'string' ? next : definition.defaultValue,
                        }))
                      }
                      disabled={!canEdit || save.isPending}
                    >
                      <SelectTrigger id={definition.key} className="w-full sm:w-72">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {definition.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={definition.key}
                      type="number"
                      className="w-full sm:w-40"
                      min={definition.min}
                      max={definition.max}
                      value={String(value)}
                      disabled={!canEdit || save.isPending}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          [definition.key]:
                            event.target.value === ''
                              ? definition.defaultValue
                              : Number(event.target.value),
                        }))
                      }
                    />
                  )}

                  <p className="text-muted-foreground font-mono text-[11px]">
                    {definition.key}
                  </p>
                </div>
              );
            })}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setDraft({})}
            disabled={changed.length === 0 || save.isPending}
          >
            <RotateCcw className="size-4" />
            Batalkan
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={changed.length === 0 || save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Simpan {changed.length > 0 && `(${changed.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}
