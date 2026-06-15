import { parseDateOnly, toDateOnly, addDaysDateOnly, daysBetweenDateOnly, dayOfWeekBit } from './date-only';

describe('date-only helper', () => {
  it('parseDateOnly yields the same calendar day in local time', () => {
    const d = parseDateOnly('2026-03-08'); // US spring-forward date
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);   // March (0-based)
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(12);  // anchored at local noon
  });

  it('toDateOnly round-trips a parsed date-only string', () => {
    expect(toDateOnly(parseDateOnly('2026-03-08'))).toBe('2026-03-08');
  });

  it('addDaysDateOnly does not shift across a DST boundary', () => {
    expect(addDaysDateOnly('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysDateOnly('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('daysBetweenDateOnly counts whole days across DST', () => {
    expect(daysBetweenDateOnly('2026-03-09', '2026-03-08')).toBe(1);
    expect(daysBetweenDateOnly('2026-11-02', '2026-10-31')).toBe(2);
    expect(daysBetweenDateOnly('2026-03-08', '2026-03-08')).toBe(0);
  });

  it('dayOfWeekBit returns the correct weekday bit', () => {
    // 2026-06-15 is a Monday → getDay() === 1 → 1 << 1 === 2
    expect(dayOfWeekBit('2026-06-15')).toBe(1 << 1);
  });
});
