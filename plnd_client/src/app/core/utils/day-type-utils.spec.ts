import { activeDayTypeForDate, cycleMatchesDate, mealsForDate } from './day-type-utils';
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
  cycle_length: null, anchor_date: null, cycle_bitmask: 0,
  created_at: '2026-01-01T00:00:00Z',
  meals: [meal],
};

const weekends: DayTypeResponse = {
  id: 'we', user_id: 'u1', name: 'Weekends',
  days_bitmask: 65, // Sun+Sat (bits 0+6)
  wake_time: '08:00:00', sleep_time: '23:00:00',
  is_cycle: false,
  cycle_length: null, anchor_date: null, cycle_bitmask: 0,
  created_at: '2026-01-01T00:00:00Z',
  meals: [],
};

function cycleType(
  id: string,
  name: string,
  cycle_length: number,
  anchor_date: string,
  cycle_bitmask: number,
  meals: MealPatternEntry[] = [],
): DayTypeResponse {
  return {
    id, user_id: 'u1', name,
    days_bitmask: 0,
    wake_time: '07:00:00', sleep_time: '22:00:00',
    is_cycle: true,
    cycle_length, anchor_date, cycle_bitmask,
    created_at: '2026-01-01T00:00:00Z',
    meals,
  };
}

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

  it('resolves cycle types via cycle_bitmask', () => {
    // Length=2, bitmask=0b01 → matches anchor and anchor+2, not anchor+1.
    const cycle = cycleType('c1', 'Alt', 2, '2026-05-11', 0b01);
    expect(activeDayTypeForDate('2026-05-11', [cycle])).toBe(cycle);
    expect(activeDayTypeForDate('2026-05-13', [cycle])).toBe(cycle);
    expect(() => activeDayTypeForDate('2026-05-12', [cycle])).toThrowError(/data integrity/);
  });
});

describe('cycleMatchesDate', () => {
  // Anchor 2026-05-11 (Mon). 4-day cycle: Day, Night, Off, Off.
  const anchor = '2026-05-11';
  const day   = cycleType('d', 'Day',   4, anchor, 0b0001);
  const night = cycleType('n', 'Night', 4, anchor, 0b0010);
  const off   = cycleType('o', 'Off',   4, anchor, 0b1100);

  it('matches each partition position', () => {
    expect(cycleMatchesDate(day,   '2026-05-11')).toBe(true);  // pos 0
    expect(cycleMatchesDate(night, '2026-05-12')).toBe(true);  // pos 1
    expect(cycleMatchesDate(off,   '2026-05-13')).toBe(true);  // pos 2
    expect(cycleMatchesDate(off,   '2026-05-14')).toBe(true);  // pos 3
  });

  it('does not double-match across partitions', () => {
    expect(cycleMatchesDate(day,   '2026-05-12')).toBe(false);
    expect(cycleMatchesDate(night, '2026-05-13')).toBe(false);
    expect(cycleMatchesDate(off,   '2026-05-11')).toBe(false);
  });

  it('repeats after one cycle length', () => {
    expect(cycleMatchesDate(day, '2026-05-15')).toBe(true);  // anchor + 4 → pos 0
    expect(cycleMatchesDate(off, '2026-05-17')).toBe(true);  // anchor + 6 → pos 2
  });

  it('handles dates before the anchor (Euclidean remainder)', () => {
    // 4 days before anchor → pos 0; 1 day before → pos 3.
    expect(cycleMatchesDate(day, '2026-05-07')).toBe(true);
    expect(cycleMatchesDate(off, '2026-05-10')).toBe(true);
    expect(cycleMatchesDate(day, '2026-05-10')).toBe(false);
  });

  it('returns false when cycle metadata is incomplete', () => {
    const bad = { ...day, cycle_length: null };
    expect(cycleMatchesDate(bad, '2026-05-11')).toBe(false);
    const bad2 = { ...day, anchor_date: null };
    expect(cycleMatchesDate(bad2, '2026-05-11')).toBe(false);
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

  it('returns meals from the active cycle day type', () => {
    const dayMeal = { ...meal, id: 'mday', name: 'Day-Breakfast' };
    const day = cycleType('d', 'Day', 4, '2026-05-11', 0b0001, [dayMeal]);
    expect(mealsForDate('2026-05-11', [day])).toEqual([dayMeal]);
  });
});
