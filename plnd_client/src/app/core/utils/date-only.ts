// plnd_client/src/app/core/utils/date-only.ts
// The single date-only helper. Parses YYYY-MM-DD at LOCAL NOON so calendar
// arithmetic and locale formatting never cross a day boundary under any
// timezone offset or DST transition (noon ± 1h DST drift stays within the day).
// Replaces the scattered 'T12:00:00Z' / 'T12:00:00' / 'T00:00:00' /
// new Date(y, m-1, d) conventions (see #920 / design decision D7).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a `YYYY-MM-DD` date-only string as a Date at local noon. */
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Format a Date back to `YYYY-MM-DD` using its local calendar components. */
export function toDateOnly(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Add `n` days (may be negative) to a date-only string, returning a date-only string. */
export function addDaysDateOnly(iso: string, n: number): string {
  const d = parseDateOnly(iso);
  d.setDate(d.getDate() + n);
  return toDateOnly(d);
}

/** Whole-day count `later - earlier` between two date-only strings. */
export function daysBetweenDateOnly(later: string, earlier: string): number {
  const ms = parseDateOnly(later).getTime() - parseDateOnly(earlier).getTime();
  return Math.round(ms / MS_PER_DAY);
}

/** Day-of-week bit (0=Sun…6=Sat → `1 << dow`) for a date-only string. */
export function dayOfWeekBit(iso: string): number {
  return 1 << parseDateOnly(iso).getDay();
}
