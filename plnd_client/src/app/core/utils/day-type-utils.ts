import { DayTypeResponse } from '../models/day-type';
import { MealPatternEntry } from '../models/meal-pattern';
import { dayOfWeekBit, daysBetweenDateOnly } from './date-only';

// True if a cycle-mode day type covers `date`. Mirrors the Rust resolver:
// computes (date − anchor) mod cycle_length as a non-negative position and
// tests the corresponding bit in cycle_bitmask. Returns false for cycle types
// missing length or anchor (should be unreachable post-validation).
export function cycleMatchesDate(dt: DayTypeResponse, date: string): boolean {
  if (!dt.cycle_length || dt.cycle_length <= 0 || !dt.anchor_date) return false;
  const offset = daysBetweenDateOnly(date, dt.anchor_date);
  // JS `%` returns the sign of the dividend, so normalize to [0, length).
  const position = ((offset % dt.cycle_length) + dt.cycle_length) % dt.cycle_length;
  return (dt.cycle_bitmask & (1 << position)) !== 0;
}

/**
 * Returns the active DayTypeResponse for a given calendar date. Weekday types
 * match by `days_bitmask`; cycle types match by `cycle_bitmask` against the
 * date's offset from `anchor_date`. Throws if no day type covers the date —
 * this indicates a data-integrity error, since every date must belong to
 * exactly one day type.
 */
export function activeDayTypeForDate(
  date: string,
  dayTypes: DayTypeResponse[],
): DayTypeResponse {
  const bit = dayOfWeekBit(date);
  const match = dayTypes.find(dt =>
    dt.is_cycle ? cycleMatchesDate(dt, date) : (dt.days_bitmask & bit) !== 0,
  );
  if (match) return match;
  throw new Error(`No day type covers date ${date} — data integrity error`);
}

/**
 * Returns the meal list for the active day type on a given date.
 * The meals array is populated on DayTypeResponse after day-types-substep saves.
 */
export function mealsForDate(
  date: string,
  dayTypes: DayTypeResponse[],
): MealPatternEntry[] {
  if (dayTypes.length === 0) return [];
  return activeDayTypeForDate(date, dayTypes).meals ?? [];
}
