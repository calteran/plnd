import { daysInRange } from './date-format.utils';

describe('daysInRange', () => {
  it('returns empty array when start is empty', () => {
    expect(daysInRange('', '2026-03-27')).toEqual([]);
  });

  it('returns empty array when end is empty', () => {
    expect(daysInRange('2026-03-23', '')).toEqual([]);
  });

  it('returns a single day when start === end', () => {
    expect(daysInRange('2026-03-23', '2026-03-23')).toEqual(['2026-03-23']);
  });

  it('returns 5 days for a Mon–Fri span', () => {
    expect(daysInRange('2026-03-23', '2026-03-27')).toEqual([
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27',
    ]);
  });

  it('returns 7 days for a full week', () => {
    const result = daysInRange('2026-03-23', '2026-03-29');
    expect(result.length).toBe(7);
    expect(result[0]).toBe('2026-03-23');
    expect(result[6]).toBe('2026-03-29');
  });

  it('handles month roll-over (Mar 30 → Apr 1)', () => {
    expect(daysInRange('2026-03-30', '2026-04-01')).toEqual([
      '2026-03-30', '2026-03-31', '2026-04-01',
    ]);
  });
});
