import { rruleFromRecurrence, recurrenceTagFromRrule } from './routine';

describe('rruleFromRecurrence', () => {
  it('daily → FREQ=DAILY', () => {
    expect(rruleFromRecurrence('daily')).toBe('FREQ=DAILY');
  });

  it('weekdays → FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', () => {
    expect(rruleFromRecurrence('weekdays')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('weekly with weekDay=1 (Monday) → FREQ=WEEKLY;BYDAY=MO', () => {
    expect(rruleFromRecurrence('weekly', 1)).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('weekly with weekDay=5 (Friday) → FREQ=WEEKLY;BYDAY=FR', () => {
    expect(rruleFromRecurrence('weekly', 5)).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  it('weekly with no weekDay defaults to Monday', () => {
    expect(rruleFromRecurrence('weekly')).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('monthly → FREQ=MONTHLY', () => {
    expect(rruleFromRecurrence('monthly')).toBe('FREQ=MONTHLY');
  });

  it('yearly → FREQ=YEARLY', () => {
    expect(rruleFromRecurrence('yearly')).toBe('FREQ=YEARLY');
  });

  it('weekly with out-of-range weekDay falls back to MO', () => {
    expect(rruleFromRecurrence('weekly', 99)).toBe('FREQ=WEEKLY;BYDAY=MO');
  });
});

describe('recurrenceTagFromRrule', () => {
  it('FREQ=DAILY → daily', () => {
    expect(recurrenceTagFromRrule('FREQ=DAILY')).toBe('daily');
  });

  it('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR → weekdays', () => {
    expect(recurrenceTagFromRrule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('weekdays');
  });

  it('FREQ=WEEKLY → weekly', () => {
    expect(recurrenceTagFromRrule('FREQ=WEEKLY')).toBe('weekly');
  });

  it('FREQ=WEEKLY;BYDAY=MO,WE,FR → weekly', () => {
    expect(recurrenceTagFromRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('weekly');
  });

  it('FREQ=MONTHLY → monthly', () => {
    expect(recurrenceTagFromRrule('FREQ=MONTHLY')).toBe('monthly');
  });

  it('FREQ=YEARLY → yearly', () => {
    expect(recurrenceTagFromRrule('FREQ=YEARLY')).toBe('yearly');
  });

  it('FREQ=DAILY;INTERVAL=2 → null (complex RRULE)', () => {
    expect(recurrenceTagFromRrule('FREQ=DAILY;INTERVAL=2')).toBeNull();
  });

  it('empty string → null', () => {
    expect(recurrenceTagFromRrule('')).toBeNull();
  });
});
