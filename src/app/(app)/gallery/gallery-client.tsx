'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Images,
  Loader2,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { GalleryLightbox } from './gallery-lightbox';
import { GalleryUploadDialog } from './gallery-upload-dialog';
import {
  CATEGORY_LABELS,
  type ImageCategory,
  type ImageDto,
  type SiteRef,
  type UploaderRef,
  formatBytes,
} from './types';

/** `''` is "all"; the two enum members narrow the query. */
const CATEGORY_TABS: { value: ImageCategory | ''; label: string }[] = [
  { value: '', label: 'Semua' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'TURNOVER', label: 'Turnover' },
];

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: {
    page?: number;
    total?: number;
    totalPages?: number;
    uploaders?: UploaderRef[];
  };
}

interface GalleryClientProps {
  sites: SiteRef[];
  canUpload: boolean;
  canDelete: boolean;
  canDownload: boolean;
  canBulkDownload: boolean;
}

const NO_IMAGES: ImageDto[] = [];
const NO_UPLOADERS: UploaderRef[] = [];

export function GalleryClient({
  sites,
  canUpload,
  canDelete,
  canDownload,
  canBulkDownload,
}: GalleryClientProps) {
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState('');
  const [uploaderId, setUploaderId] = useState('');
  const [category, setCategory] = useState<ImageCategory | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<ImageDto | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const query = useQuery({
    queryKey: ['gallery', { siteId, uploaderId, category, from, to, search, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), perPage: '40' });
      if (siteId) params.set('siteId', siteId);
      if (uploaderId) params.set('uploaderId', uploaderId);
      if (category) params.set('category', category);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (search.trim()) params.set('search', search.trim());

      const response = await fetch(`/api/gallery?${params.toString()}`);
      const payload = (await response.json()) as Envelope<ImageDto[]>;
      if (!payload.success) throw new Error(payload.message);
      return payload;
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/gallery/${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as Envelope<unknown>;
      if (!payload.success) throw new Error(payload.message);
    },
    onSuccess: () => {
      toast.success('Gambar dihapus.');
      setLightbox(null);
      void queryClient.invalidateQueries({ queryKey: ['gallery'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const images = query.data?.data ?? NO_IMAGES;
  const uploaders = query.data?.meta.uploaders ?? NO_UPLOADERS;
  const total = query.data?.meta.total ?? 0;
  const totalPages = query.data?.meta.totalPages ?? 1;

  const currentFilters = {
    ...(siteId ? { siteIds: [siteId] } : {}),
    ...(uploaderId ? { uploaderId } : {}),
    ...(category ? { category } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Streams the archive to disk via an object URL.
   *
   * The response is consumed as a blob because the browser needs the complete
   * bytes to trigger a save; the server streams it, so memory on that side is
   * bounded regardless.
   */
  async function downloadZip(body: unknown, label: string) {
    setDownloading(true);
    try {
      const response = await fetch('/api/gallery/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        toast.error(payload.message ?? 'Gagal mengunduh.');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `gallery-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success(`${label} berhasil diunduh.`);
    } catch {
      toast.error('Gagal mengunduh. Periksa koneksi Anda.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gallery</h1>
          <p className="text-muted-foreground text-sm">
            {total.toLocaleString('id-ID')} gambar
            {selected.size > 0 && ` · ${selected.size} dipilih`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canBulkDownload && total > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                downloadZip({ filters: currentFilters }, 'Semua hasil filter')
              }
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Unduh hasil filter
            </Button>
          )}
          {canUpload && (
            <Button onClick={() => setUploadOpen(true)} disabled={sites.length === 0}>
              <Upload className="size-4" />
              Unggah
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border/60 sticky top-14 z-20 p-3">
        <div className="mb-3 flex gap-1 border-b pb-3">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.value || 'all'}
              type="button"
              onClick={() => {
                setCategory(tab.value);
                setPage(1);
                // Selection is cleared on tab change: the picks would otherwise
                // stay live but invisible, and a later bulk download would
                // include images the user can no longer see.
                setSelected(new Set());
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                category === tab.value
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nama berkas…"
              className="pl-9"
            />
          </div>

          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPage(1);
            }}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            aria-label="Site"
          >
            <option value="">Semua site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>

          <select
            value={uploaderId}
            onChange={(e) => {
              setUploaderId(e.target.value);
              setPage(1);
            }}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            aria-label="Pengunggah"
          >
            <option value="">Semua pengunggah</option>
            {uploaders.map((uploader) => (
              <option key={uploader.id} value={uploader.id}>
                {uploader.name}
              </option>
            ))}
          </select>

          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Dari tanggal"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Sampai tanggal"
          />
        </div>

        {selected.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            <Badge variant="secondary" className="font-normal">
              {selected.size} dipilih
            </Badge>
            {canBulkDownload && (
              <Button
                size="sm"
                onClick={() =>
                  downloadZip({ imageIds: [...selected] }, 'Gambar terpilih')
                }
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Unduh terpilih (ZIP)
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set(images.map((image) => image.id)))}
            >
              <CheckCheck className="size-4" />
              Pilih semua di halaman ini
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="size-4" />
              Bersihkan
            </Button>
          </div>
        )}
      </Card>

      {query.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <Card className="border-border/60 border-dashed">
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Images className="text-muted-foreground size-8" />
            <p className="font-medium">Belum ada gambar</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              {canUpload
                ? 'Unggah gambar pertama, atau longgarkan filter di atas.'
                : 'Longgarkan filter di atas untuk melihat gambar lain.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image) => {
            const isSelected = selected.has(image.id);
            return (
              <Card
                key={image.id}
                className={cn(
                  'group relative overflow-hidden p-0 transition-all',
                  isSelected ? 'ring-primary ring-2' : 'hover:shadow-md',
                )}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(image)}
                  className="block w-full"
                >
                  <div className="bg-muted aspect-square overflow-hidden">
                    {/* A plain <img>, not next/image: these are already
                        thumbnail-sized WebP served from a CDN, so the optimiser
                        would add a proxy hop through this server and couple
                        next.config to the customer's CDN hostname — cost and
                        coupling for an image that is already optimised. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.thumbnailUrl ?? image.cdnUrl}
                      alt={image.originalName}
                      loading="lazy"
                      className="size-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                </button>

                <button
                  type="button"
                  aria-label={isSelected ? 'Batalkan pilihan' : 'Pilih gambar'}
                  onClick={() => toggle(image.id)}
                  className={cn(
                    'absolute top-2 left-2 flex size-5 items-center justify-center rounded border transition-colors',
                    // Always rendered, never hover-gated: on a touch device a
                    // hover-only checkbox is unreachable, so bulk selection
                    // would simply not exist there.
                    isSelected
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-white/80 bg-black/40 hover:bg-black/60',
                  )}
                >
                  {isSelected && <CheckCheck className="size-3" />}
                </button>

                <div className="space-y-1 p-2">
                  <p
                    className="truncate text-xs font-medium"
                    title={image.originalName}
                  >
                    {image.originalName}
                  </p>
                  <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                    <span>{image.siteCode}</span>
                    <span>{formatBytes(image.size)}</span>
                  </div>
                  {/* Shown even when a category tab is active: the grid is also
                      reached from "Semua", where the label is the only thing
                      distinguishing the two families. */}
                  <Badge
                    variant="outline"
                    className={cn(
                      'w-full justify-center py-0 text-[10px] font-normal',
                      image.category === 'MONTHLY'
                        ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                        : 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
                    )}
                  >
                    {CATEGORY_LABELS[image.category]}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Halaman {page} dari {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="size-4" />
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Berikutnya
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <GalleryLightbox
        image={lightbox}
        canDownload={canDownload}
        canDelete={canDelete}
        deleting={removeMutation.isPending}
        onClose={() => setLightbox(null)}
        onDelete={(id) => removeMutation.mutate(id)}
      />

      <GalleryUploadDialog
        open={uploadOpen}
        sites={sites}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => void queryClient.invalidateQueries({ queryKey: ['gallery'] })}
      />
    </div>
  );
}
