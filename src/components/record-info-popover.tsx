'use client';

import { format } from 'date-fns';
import { Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface RecordInfoPopoverProps {
  /** ISO 8601 timestamp for when the record was created. */
  createdAt: string;
  /** ISO 8601 timestamp for when the record was last updated. */
  updatedAt: string;
  /** Display name of who created the record; null when unknown. */
  createdBy: string | null;
  /** Display name of who last edited the record; null when unknown. */
  updatedBy: string | null;
  /** Appended to the trigger's accessible label, e.g. the report date. */
  label?: string;
}

function stamp(iso: string): string {
  const date = new Date(iso);
  return `${format(date, 'dd/MM/yyyy')} · ${format(date, 'HH:mm')}`;
}

/**
 * One created/edited entry: a muted heading, the timestamp, and the actor.
 *
 * `by` falls back to "Sistem" rather than being hidden — the same word the
 * audit log uses when no user is attached — so the row reads consistently
 * whether or not an author was recorded.
 */
function Entry({
  heading,
  at,
  by,
}: {
  heading: string;
  at: string;
  by: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{heading}</dt>
      <dd className="font-medium tabular-nums">{stamp(at)}</dd>
      <dd className="text-muted-foreground">oleh {by ?? 'Sistem'}</dd>
    </div>
  );
}

/**
 * A quiet "ⓘ" affordance that reveals a record's audit trail on click: when it
 * was created and last edited, and by whom.
 *
 * Click rather than hover: the detail is reference material, not something to
 * surface every time the pointer crosses a row, and hover has no equivalent on
 * touch. The Popover portals its content, so it floats clear of the table's
 * horizontal and vertical scroll containers instead of being clipped by them.
 */
export function RecordInfoPopover({
  createdAt,
  updatedAt,
  createdBy,
  updatedBy,
  label,
}: RecordInfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label ? `Informasi laporan ${label}` : 'Informasi laporan'}
          />
        }
      >
        <Info className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-56">
        <dl className="space-y-3 text-xs">
          <Entry heading="Dibuat" at={createdAt} by={createdBy} />
          <Entry heading="Diperbarui" at={updatedAt} by={updatedBy} />
        </dl>
      </PopoverContent>
    </Popover>
  );
}
