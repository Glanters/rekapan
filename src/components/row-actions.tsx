'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface RowActionsProps {
  /** Names the row in accessible labels, e.g. the report date. */
  label: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Edit / delete for one report row.
 *
 * Two icon buttons from `sm` up. On a phone they collapse into one "⋯" menu:
 * the action column is pinned to the right edge, and at 375px pinned buttons
 * leave the figures themselves barely a column of room. Who changed the row,
 * and when, lives in the table's own "Diubah" column, not here.
 */
export function RowActions({
  label,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: RowActionsProps) {
  if (!canEdit && !canDelete) return null;

  return (
    <>
      <div className="hidden items-center justify-end gap-0.5 sm:flex">
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Ubah laporan ${label}`}
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Hapus laporan ${label}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex justify-end sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Aksi laporan ${label}`}
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {canEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4" />
                Ubah
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="size-4" />
                Hapus
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
