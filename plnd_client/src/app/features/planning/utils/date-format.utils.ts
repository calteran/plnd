// plnd_client/src/app/features/planning/utils/date-format.utils.ts
// Shared date-formatting helpers for planning wizard step components.
// All parsing goes through the noon-anchored local date-only helper.
import { parseDateOnly, addDaysDateOnly } from '../../../core/utils/date-only';

/** "Mon, Jan 6" */
export function formatDate(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** "Jan 6" */
export function formatDayDate(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Mon" */
export function formatDayName(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString('en-US', { weekday: 'short' });
}

/** "Jan 6" — alias of {@link formatDayDate} used by the planning week-range headers. */
export function formatWeekDate(isoDate: string): string {
  return formatDayDate(isoDate);
}

/** ISO date strings from start to end inclusive. */
export function daysInRange(start: string, end: string): string[] {
  if (!start || !end) return [];
  const days: string[] = [];
  for (let cur = start; cur <= end; cur = addDaysDateOnly(cur, 1)) days.push(cur);
  return days;
}
