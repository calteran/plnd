import { DayTypeResponse } from '../models/day-type';
import { MealPatternEntry } from '../models/meal-pattern';

// Returns the day-of-week bit (0=Sun…6=Sat) for a YYYY-MM-DD string.
// Uses noon UTC to avoid DST edge cases when parsing the date.
function dayOfWeekBit(date: string): number {
  return 1 << new Date(date + 'T12:00:00Z').getUTCDay();
}

/**
 * Returns the active DayTypeResponse for a given calendar date.
 * Checks 7-day types by bitmask first, then falls back to the default.
 * Cycle day types are skipped (forward work).
 */
export function activeDayTypeForDate(
  date: string,
  dayTypes: DayTypeResponse[],
): DayTypeResponse | undefined {
  const bit = dayOfWeekBit(date);
  const match = dayTypes.find(dt => !dt.is_cycle && (dt.days_bitmask & bit) !== 0);
  if (match) return match;
  return dayTypes.find(dt => dt.is_default);
}

/**
 * Returns the meal list for the active day type on a given date.
 * The meals array is populated on DayTypeResponse after day-types-substep saves.
 */
export function mealsForDate(
  date: string,
  dayTypes: DayTypeResponse[],
): MealPatternEntry[] {
  return activeDayTypeForDate(date, dayTypes)?.meals ?? [];
}
