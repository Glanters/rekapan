'use client';

import { ImageDown, Loader2 } from 'lucide-react';
import { type RefObject, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { downloadTableImage } from '@/lib/table-image';

interface TableImageButtonProps {
  /** The scroll wrapper around the table; the `<table>` inside it is captured. */
  targetRef: RefObject<HTMLDivElement | null>;
  /** Download file name, e.g. `turnover_2026-07-01_2026-07-22.png`. */
  filename: string;
  disabled?: boolean;
}

/**
 * Downloads the report table as a PNG image.
 *
 * Captures the `<table>` node rather than its scroll wrapper so the whole grid —
 * every row and every column, past the edges of the viewport — is in the image.
 * Available to anyone who can see the table: it is a snapshot of what is already
 * on screen, no more revealing than a manual screenshot.
 */
export function TableImageButton({
  targetRef,
  filename,
  disabled,
}: TableImageButtonProps) {
  const [busy, setBusy] = useState(false);

  async function run() {
    const node = targetRef.current?.querySelector('table') ?? targetRef.current;
    if (!node) return;

    setBusy(true);
    try {
      await downloadTableImage(node, filename);
    } catch {
      toast.error('Gagal membuat gambar tabel.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={disabled || busy}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ImageDown className="size-4" />
      )}
      Unduh gambar
    </Button>
  );
}
