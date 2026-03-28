// plnd_client/src/app/features/planning/utils/date-format.utils.ts
// Shared date-formatting helpers for planning wizard step components.
//
// All functions parse the ISO date string at noon local time (T12:00:00) to
// avoid timezone-boundary shifts that would corrupt locale formatting when the
// date-only string is parsed as UTC midnight.

function noonDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
}

/** "Mon, Jan 6" — weekday short + month short + day */
export function formatDate(isoDate: string): string {
  return noonDate(isoDate).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** "Jan 6" — month short + day, used for week range labels */
export function formatWeekDate(isoDate: string): string {
  return noonDate(isoDate).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

/** "Mon" — weekday short, used for day column headers */
export function formatDayName(isoDate: string): string {
  return noonDate(isoDate).toLocaleDateString('en-US', { weekday: 'short' });
}

/** "Jan 6" — month short + day, used for day column sub-labels */
export function formatDayDate(isoDate: string): string {
  return noonDate(isoDate).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}
