import { rruleFromRecurrence } from './schedule-template';

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

  it('custom with a rule passes through the rule string', () => {
    expect(rruleFromRecurrence('custom', undefined, 'FREQ=MONTHLY;BYMONTHDAY=1')).toBe('FREQ=MONTHLY;BYMONTHDAY=1');
  });

  it('custom with no rule returns empty string', () => {
    expect(rruleFromRecurrence('custom')).toBe('');
  });
});
