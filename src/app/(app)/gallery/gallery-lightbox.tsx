'use client';

import {
  Building2,
  Calendar,
  Download,
  FolderTree,
  Loader2,
  Maximize2,
  Trash2,
  User,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { CATEGORY_LABELS, type ImageDto, formatBytes } from './types';

interface GalleryLightboxProps {
  image: ImageDto | null;
  canDownload: boolean;
  canDelete: boolean;
  deleting: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function GalleryLightbox({
  image,
  canDownload,
  canDelete,
  deleting,
  onClose,
  onDelete,
}: GalleryLightboxProps) {
  const [zoomed, setZoomed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset per-image view state, so a previously zoomed or half-confirmed
  // delete does not carry over to the next image opened.
  useEffect(() => {
    setZoomed(false);
    setConfirmingDelete(false);
  }, [image?.id]);

  if (!image) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{image.originalName}</DialogTitle>
          <DialogDescription>
            {image.width && image.height
              ? `${image.width} × ${image.height} px · ${formatBytes(image.size)}`
              : formatBytes(image.size)}
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'bg-muted flex justify-center overflow-auto rounded-lg',
            zoomed ? 'max-h-[60svh]' : 'max-h-[55svh]',
          )}
        >
          {/* Full-resolution original, deliberately unoptimised: this is the
              view where the user is inspecting detail, and downscaling it
              would defeat the purpose of opening it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.cdnUrl}
            alt={image.originalName}
            onClick={() => setZoomed((v) => !v)}
            className={cn(
              'transition-transform',
              zoomed
                ? 'max-w-none origin-top scale-150 cursor-zoom-out'
                : 'max-h-[55svh] cursor-zoom-in object-contain',
            )}
          />
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Building2 className="text-muted-foreground size-4" />
            <span className="text-muted-foreground">Site</span>
            <Badge variant="secondary" className="ml-auto font-normal">
              {image.siteName}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <User className="text-muted-foreground size-4" />
            <span className="text-muted-foreground">Pengunggah</span>
            <span className="ml-auto truncate">{image.uploaderName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="text-muted-foreground size-4" />
            <span className="text-muted-foreground">Tanggal unggah</span>
            <span className="ml-auto">{image.uploadDate}</span>
          </div>
          <div className="flex items-center gap-2">
            <Maximize2 className="text-muted-foreground size-4" />
            <span className="text-muted-foreground">Format</span>
            <span className="ml-auto uppercase">{image.extension}</span>
          </div>
          <div className="flex items-center gap-2">
            <FolderTree className="text-muted-foreground size-4" />
            <span className="text-muted-foreground">Kategori</span>
            <Badge
              variant="outline"
              className={cn(
                'ml-auto font-normal',
                image.category === 'MONTHLY'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                  : 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
              )}
            >
              {CATEGORY_LABELS[image.category]}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {canDownload && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(image.cdnUrl, '_blank')}
              >
                <Download className="size-4" />
                Unduh asli
              </Button>
              {image.thumbnailUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(image.thumbnailUrl!, '_blank')}
                >
                  <Download className="size-4" />
                  Unduh thumbnail
                </Button>
              )}
            </>
          )}

          {canDelete && (
            <div className="ml-auto">
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">Yakin hapus?</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    Batal
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(image.id)}
                    disabled={deleting}
                  >
                    {deleting && <Loader2 className="size-4 animate-spin" />}
                    Hapus
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                  className="text-destructive"
                >
                  <Trash2 className="size-4" />
                  Hapus
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
