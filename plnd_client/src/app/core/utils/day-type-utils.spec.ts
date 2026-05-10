import { activeDayTypeForDate, mealsForDate } from './day-type-utils';
import { DayTypeResponse } from '../models/day-type';
import { MealPatternEntry } from '../models/meal-pattern';

const meal: MealPatternEntry = {
  id: 'm1', day_type_id: 'wd', user_id: 'u1',
  name: 'Breakfast', preferred_time: '08:00:00',
  tolerance_minutes: 30, sort_order: 0,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

const weekdays: DayTypeResponse = {
  id: 'wd', user_id: 'u1', name: 'Weekdays',
  days_bitmask: 62, // Mon–Fri (bits 1-5)
  wake_time: '07:00:00', sleep_time: '22:00:00',
  is_cycle: false,
  cycle_length: null, anchor_date: null,
  created_at: '2026-01-01T00:00:00Z',
  meals: [meal],
};

const weekends: DayTypeResponse = {
  id: 'we', user_id: 'u1', name: 'Weekends',
  days_bitmask: 65, // Sun+Sat (bits 0+6)
  wake_time: '08:00:00', sleep_time: '23:00:00',
  is_cycle: false,
  cycle_length: null, anchor_date: null,
  created_at: '2026-01-01T00:00:00Z',
  meals: [],
};

describe('activeDayTypeForDate', () => {
  it('returns weekday type for a Monday (2026-05-11)', () => {
    expect(activeDayTypeForDate('2026-05-11', [weekdays, weekends])).toBe(weekdays);
  });

  it('returns weekend type for a Saturday (2026-05-09)', () => {
    expect(activeDayTypeForDate('2026-05-09', [weekdays, weekends])).toBe(weekends);
  });

  it('returns weekend type for a Sunday (2026-05-10)', () => {
    expect(activeDayTypeForDate('2026-05-10', [weekdays, weekends])).toBe(weekends);
  });

  it('throws when no bitmask covers the date (data integrity error)', () => {
    const noMatch = { ...weekdays, days_bitmask: 0 };
    expect(() => activeDayTypeForDate('2026-05-11', [noMatch])).toThrowError(/data integrity/);
  });

  it('throws when dayTypes is empty', () => {
    expect(() => activeDayTypeForDate('2026-05-11', [])).toThrowError(/data integrity/);
  });

  it('skips cycle day types (cycle mode is forward work)', () => {
    const cycle = { ...weekdays, is_cycle: true, days_bitmask: 0 };
    expect(() => activeDayTypeForDate('2026-05-11', [cycle])).toThrowError(/data integrity/);
  });
});

describe('mealsForDate', () => {
  it('returns meals for the active day type', () => {
    // 2026-05-11 is a Monday → weekdays
    expect(mealsForDate('2026-05-11', [weekdays, weekends])).toEqual([meal]);
  });

  it('returns empty array when active day type has no meals', () => {
    // 2026-05-09 is a Saturday → weekends (meals: [])
    expect(mealsForDate('2026-05-09', [weekdays, weekends])).toEqual([]);
  });

  it('returns empty array when dayTypes list is empty', () => {
    expect(mealsForDate('2026-05-11', [])).toEqual([]);
  });
});
