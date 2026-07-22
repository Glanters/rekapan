'use client';

import { AlertCircle, Check, Loader2, RotateCw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';

import {
  CATEGORY_LABELS,
  type ImageCategory,
  type SiteRef,
  formatBytes,
} from './types';

const CATEGORIES: ImageCategory[] = ['MONTHLY', 'TURNOVER'];

type ItemStatus = 'pending' | 'uploading' | 'done' | 'error' | 'cancelled';

interface UploadItem {
  id: string;
  file: File;
  status: ItemStatus;
  progress: number;
  error: string | null;
  /** Retained so the item can be cancelled mid-flight. */
  request: XMLHttpRequest | null;
}

interface GalleryUploadDialogProps {
  open: boolean;
  sites: SiteRef[];
  onClose: () => void;
  onUploaded: () => void;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export function GalleryUploadDialog({
  open,
  sites,
  onClose,
  onUploaded,
}: GalleryUploadDialogProps) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  // No default. The uploader must choose, because a pre-selected category
  // silently becomes the answer for anyone who does not look at this field.
  const [category, setCategory] = useState<ImageCategory | null>(null);
  const [uploadDate, setUploadDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: UploadItem[] = [];
    let rejected = 0;

    for (const file of Array.from(files)) {
      // A first pass on the declared type, purely to spare the user a round
      // trip. The server re-checks by decoding the file, because this value is
      // client-supplied and trivially spoofed.
      if (!ACCEPTED.includes(file.type)) {
        rejected += 1;
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        status: 'pending',
        progress: 0,
        error: null,
        request: null,
      });
    }

    if (rejected > 0) {
      toast.error(
        `${rejected} berkas dilewati — hanya JPG, PNG, dan WEBP yang didukung.`,
      );
    }

    setItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...accepted.filter((item) => !seen.has(item.id))];
    });
  }, []);

  /**
   * Clipboard paste, anywhere in the dialog.
   *
   * Listens on the document rather than a single element so Ctrl+V works
   * without first clicking a particular box — pasting a screenshot is the
   * common case, and hunting for the right focus target to make it land is
   * exactly the friction this removes.
   *
   * Pasted images are renamed locally before being queued. Every clipboard
   * image arrives called `image.png`, and the queue de-duplicates on
   * name+size+lastModified, so two screenshots taken in the same second would
   * silently collapse into one.
   */
  useEffect(() => {
    if (!open) return undefined;

    function handlePaste(event: ClipboardEvent) {
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (images.length === 0) return;
      event.preventDefault();

      addFiles(
        images.map((file, index) => {
          const extension = file.type.split('/')[1] ?? 'png';
          return new File([file], `pasted-${Date.now()}-${index}.${extension}`, {
            type: file.type,
          });
        }),
      );
      toast.success(`${images.length} gambar ditempel.`);
    }

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, addFiles]);

  function patch(id: string, changes: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  /**
   * Uploads one file.
   *
   * XMLHttpRequest rather than fetch: fetch exposes no upload-progress events,
   * and a multi-megabyte upload with no feedback reads as a frozen dialog.
   */
  function uploadOne(item: UploadItem): Promise<boolean> {
    return new Promise((resolve) => {
      const form = new FormData();
      form.append('siteId', siteId);
      form.append('category', category ?? '');
      form.append('uploadDate', uploadDate);
      form.append('file', item.file);

      const request = new XMLHttpRequest();
      patch(item.id, { status: 'uploading', progress: 0, error: null, request });

      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          patch(item.id, { progress: Math.round((event.loaded / event.total) * 100) });
        }
      });

      request.addEventListener('load', () => {
        let message = 'Gagal mengunggah.';
        try {
          const payload = JSON.parse(request.responseText) as {
            success: boolean;
            message: string;
          };
          if (payload.success) {
            patch(item.id, { status: 'done', progress: 100, request: null });
            resolve(true);
            return;
          }
          message = payload.message;
        } catch {
          /* fall through to the generic message */
        }
        patch(item.id, { status: 'error', error: message, request: null });
        resolve(false);
      });

      request.addEventListener('error', () => {
        patch(item.id, { status: 'error', error: 'Koneksi terputus.', request: null });
        resolve(false);
      });

      request.addEventListener('abort', () => {
        patch(item.id, { status: 'cancelled', request: null });
        resolve(false);
      });

      request.open('POST', '/api/gallery');
      request.send(form);
    });
  }

  async function startUpload() {
    if (!siteId) {
      toast.error('Pilih site terlebih dahulu.');
      return;
    }
    if (!category) {
      toast.error('Pilih kategori: Monthly atau Turnover.');
      return;
    }

    setBusy(true);
    let succeeded = 0;

    // Sequential, not parallel. Each request carries the full file body, so
    // firing them all at once saturates the uplink and makes every individual
    // progress bar meaningless.
    for (const item of items) {
      if (item.status === 'done') continue;
      const ok = await uploadOne(item);
      if (ok) succeeded += 1;
    }

    setBusy(false);

    if (succeeded > 0) {
      toast.success(`${succeeded} gambar diunggah.`);
      onUploaded();
    }
  }

  function reset() {
    for (const item of items) item.request?.abort();
    setItems([]);
    setCategory(null);
    onClose();
  }

  const pending = items.filter((item) => item.status !== 'done').length;
  const allDone = items.length > 0 && pending === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && reset()}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Unggah gambar</DialogTitle>
          <DialogDescription>
            JPG, PNG, atau WEBP. Nama berkas diganti otomatis menjadi nama site dan
            tanggal, jadi nama aslinya tidak perlu diperhatikan.
          </DialogDescription>
        </DialogHeader>

        {/* Segmented, not a dropdown: with two options and no default, a
            closed select would hide that a choice is still outstanding. */}
        <div className="space-y-2">
          <Label>
            Kategori<span className="text-destructive"> *</span>
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((option) => {
              const active = category === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  disabled={busy}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {CATEGORY_LABELS[option]}
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            Menentukan laporan mana yang didukung gambar ini. Tidak dapat diubah setelah
            diunggah.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="u-site">Site</Label>
            <select
              id="u-site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={busy}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-date">Tanggal</Label>
            <Input
              id="u-date"
              type="date"
              value={uploadDate}
              onChange={(e) => setUploadDate(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          disabled={busy}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50',
          )}
        >
          <Upload className="text-muted-foreground size-6" />
          <span className="text-sm font-medium">
            Tarik berkas ke sini, atau klik untuk memilih
          </span>
          <span className="text-muted-foreground text-xs">
            Bisa juga tempel langsung dengan{' '}
            <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
              Ctrl
            </kbd>
            {' + '}
            <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
              V
            </kbd>
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(',')}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {items.length > 0 && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.file.name}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {formatBytes(item.file.size)}
                    {item.error && (
                      <span className="text-destructive"> · {item.error}</span>
                    )}
                  </p>
                  {item.status === 'uploading' && (
                    <div className="bg-muted mt-1 h-1 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full transition-all"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                {item.status === 'done' && (
                  <Check className="size-4 shrink-0 text-emerald-600" />
                )}
                {item.status === 'uploading' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Batalkan"
                    onClick={() => item.request?.abort()}
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {(item.status === 'error' || item.status === 'cancelled') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Coba lagi"
                    onClick={() => void uploadOne(item)}
                    disabled={busy}
                  >
                    <RotateCw className="size-4" />
                  </Button>
                )}
                {item.status === 'pending' && !busy && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus dari daftar"
                    onClick={() =>
                      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
                    }
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {items.some((item) => item.status === 'error') && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <AlertCircle className="size-3.5" />
            Berkas yang gagal dapat diulang tanpa mengunggah ulang yang berhasil.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={reset} disabled={busy}>
            {allDone ? 'Tutup' : 'Batal'}
          </Button>
          <Button onClick={startUpload} disabled={busy || pending === 0 || !category}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Unggah {pending > 0 && `(${pending})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
