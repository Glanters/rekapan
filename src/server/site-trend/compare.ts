/**
 * Pure comparison rules for the Naik Turun Site report, kept apart from the
 * queries so they can be tested without a database.
 */

/** A change smaller than this share either way is reported as steady. */
export const SIGNIFICANT_CHANGE = 0.1;

export type ChangeDirection = 'up' | 'down' | 'flat' | 'new' | 'gone';

export interface Change {
  /** Relative change, `(current - previous) / |previous|`; null when previous is 0. */
  ratio: number | null;
  direction: ChangeDirection;
  /** Whether the move clears the significance threshold. */
  significant: boolean;
  /**
   * Whether the move is good news. For a metric where more is worse (a
   * withdraw, a loan), a rise is unfavourable. Null when nothing moved.
   */
  favourable: boolean | null;
}

/**
 * Classifies one metric's move between two periods.
 *
 * `previous = 0` has no ratio: a metric appearing from nothing is `new`, one
 * that vanished to zero is `gone` (always significant — a site that stopped
 * filing a figure is exactly what this report is for).
 */
export function compareValues(
  current: number,
  previous: number,
  higherIsWorse = false,
): Change {
  let ratio: number | null;
  let direction: ChangeDirection;
  let significant: boolean;

  if (previous === 0) {
    ratio = null;
    direction = current === 0 ? 'flat' : 'new';
    significant = current !== 0;
  } else {
    ratio = (current - previous) / Math.abs(previous);
    if (current === 0) {
      direction = 'gone';
      significant = true;
    } else {
      direction = ratio > 0 ? 'up' : ratio < 0 ? 'down' : 'flat';
      significant = Math.abs(ratio) >= SIGNIFICANT_CHANGE;
    }
  }

  const rose = direction === 'up' || direction === 'new';
  const fell = direction === 'down' || direction === 'gone';
  const favourable = rose ? !higherIsWorse : fell ? higherIsWorse : null;

  // A move below the threshold is steady, whichever way it leaned.
  if (!significant && direction !== 'flat') direction = 'flat';

  return { ratio, direction, significant, favourable: significant ? favourable : null };
}

export interface ComparisonWindow {
  from: string;
  to: string;
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The two windows to compare for a `YYYY-MM` month, given today's date.
 *
 * Like for like: an unfinished month is compared day-for-day against the same
 * days of the month before (1–6 Oct vs 1–6 Sep), never six days against thirty.
 * A finished month compares in full. The previous window is clamped to its own
 * month's end, so 1–31 Mar compares against 1–28 Feb.
 */
export function comparisonWindows(
  month: string,
  today: string,
): { current: ComparisonWindow; previous: ComparisonWindow; days: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;

  const monthEnd = lastDayOf(year, m);
  const start = iso(year, m, 1);
  if (today < start) return null; // a future month has nothing to compare

  const isCurrentMonth = today.slice(0, 7) === month;
  const lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : monthEnd;

  const prevYear = m === 1 ? year - 1 : year;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevLastDay = Math.min(lastDay, lastDayOf(prevYear, prevMonth));

  return {
    current: { from: start, to: iso(year, m, lastDay) },
    previous: {
      from: iso(prevYear, prevMonth, 1),
      to: iso(prevYear, prevMonth, prevLastDay),
    },
    days: lastDay,
  };
}
