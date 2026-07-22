/**
 * Indonesian number and date formatting for the dashboard.
 *
 * Every figure on this page is rupiah, and rupiah amounts here run to ten or
 * eleven digits. Rendering those in full inside an axis label or a bar makes
 * the chart unreadable, so the compact forms below are used for chart
 * furniture while the stat cards and tooltips — where the exact figure is the
 * point — show it in full.
 */

const MILIAR = 1_000_000_000;
const JUTA = 1_000_000;
const RIBU = 1_000;
const TRILIUN = 1_000_000_000_000;

/**
 * Full rupiah, no decimals: `Rp 210.571.000`.
 *
 * The sign leads the currency symbol rather than the digits — `Rp -90.857.400`
 * reads as a negative quantity of rupiah, which is not what a loss is.
 */
export function formatRupiah(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '−' : '';
  return `${sign}Rp ${Math.abs(rounded).toLocaleString('id-ID')}`;
}

/** Plain integer with Indonesian thousands separators. */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('id-ID');
}

/**
 * Abbreviated rupiah for axis ticks and bar labels: `1,2 M`, `210,6 jt`.
 *
 * Indonesian abbreviations, not the browser's `notation: 'compact'` — that
 * yields "210 jt" style output in some ICU builds and "210M" in others, and an
 * axis whose units change with the runtime is worse than one that is verbose.
 */
export function formatCompact(value: number): string {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);

  if (magnitude >= TRILIUN) return `${sign}${trim(magnitude / TRILIUN)} T`;
  if (magnitude >= MILIAR) return `${sign}${trim(magnitude / MILIAR)} M`;
  if (magnitude >= JUTA) return `${sign}${trim(magnitude / JUTA)} jt`;
  if (magnitude >= RIBU) return `${sign}${trim(magnitude / RIBU)} rb`;
  return `${sign}${Math.round(magnitude).toLocaleString('id-ID')}`;
}

function trim(value: number): string {
  return value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/**
 * `2026-07-01` → `1 Jul`.
 *
 * Parsed by splitting rather than `new Date(iso)`: the API sends a business
 * date with no time, and constructing a Date from it yields UTC midnight, which
 * renders as the previous day for any viewer west of Greenwich.
 */
export function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  const monthLabel = MONTHS_SHORT[Number(month) - 1];
  if (!monthLabel || !day) return iso;
  return `${Number(day)} ${monthLabel}`;
}

/** `2026-07-01` → `1 Juli 2026`, for the period caption. */
export function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  const monthLabel = MONTHS_SHORT[Number(month) - 1];
  if (!monthLabel || !day || !year) return iso;
  return `${Number(day)} ${monthLabel} ${year}`;
}

export interface Delta {
  /** Change as a fraction of the previous period; `1` is a doubling. */
  ratio: number;
  direction: 'up' | 'down' | 'flat';
  label: string;
}

/**
 * Period-over-period change.
 *
 * Returns `null` when the previous period is zero. A jump from nothing to
 * something is not a percentage — "+∞%" or "+100%" both misrepresent it — and
 * on a near-empty database that is the common case, so the card omits the
 * delta rather than printing a number that means nothing.
 */
export function computeDelta(current: number, previous: number): Delta | null {
  if (previous === 0) return null;

  const ratio = (current - previous) / Math.abs(previous);
  const percent = Math.abs(ratio * 100);
  const rounded = percent >= 100 ? Math.round(percent) : Number(percent.toFixed(1));
  const direction = ratio > 0.0001 ? 'up' : ratio < -0.0001 ? 'down' : 'flat';
  const sign = direction === 'up' ? '+' : direction === 'down' ? '−' : '';

  return {
    ratio,
    direction,
    label: `${sign}${rounded.toLocaleString('id-ID')}%`,
  };
}
