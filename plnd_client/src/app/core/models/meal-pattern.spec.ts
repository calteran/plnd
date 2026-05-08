import { preferredTimeHHMM } from './meal-pattern';

describe('preferredTimeHHMM', () => {
  it('extracts HH:MM from a Postgres TIME string', () => {
    expect(preferredTimeHHMM('08:00:00')).toBe('08:00');
    expect(preferredTimeHHMM('12:30:00')).toBe('12:30');
    expect(preferredTimeHHMM('23:59:59')).toBe('23:59');
  });
});
