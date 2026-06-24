import { PlannedTask } from '../models/week-plan';
import { UNANCHORED_SLOT, rawSlotKey, slotMatchKey, slotKeysMatch } from './slot-key';

function task(overrides: Partial<PlannedTask>): PlannedTask {
  return { date: '2026-06-22', title: 't', energy: 'low', ...overrides };
}

describe('rawSlotKey', () => {
  it('prefers paired_meal_name in its original casing', () => {
    expect(rawSlotKey(task({ paired_meal_name: 'Breakfast' }))).toBe('Breakfast');
  });

  it('falls back to after_anchor in its original casing', () => {
    expect(rawSlotKey(task({ after_anchor: 'Start Of Day' }))).toBe('Start Of Day');
  });

  it('falls back to the unanchored sentinel when neither field is set', () => {
    expect(rawSlotKey(task({}))).toBe(UNANCHORED_SLOT);
  });
});

describe('slotMatchKey', () => {
  it('lowercases the raw slot key for comparison', () => {
    expect(slotMatchKey(task({ paired_meal_name: 'Breakfast' }))).toBe('breakfast');
    expect(slotMatchKey(task({ after_anchor: 'Start Of Day' }))).toBe('start of day');
  });

  it('returns the sentinel unchanged for unanchored tasks', () => {
    expect(slotMatchKey(task({}))).toBe(UNANCHORED_SLOT);
  });
});

describe('slotKeysMatch', () => {
  it('matches a task to its slot regardless of casing on either side', () => {
    // Production meal names are Capitalized; the place_tasks agent may drift casing.
    expect(slotKeysMatch(task({ paired_meal_name: 'breakfast' }), 'Breakfast')).toBe(true);
    expect(slotKeysMatch(task({ paired_meal_name: 'Breakfast' }), 'breakfast')).toBe(true);
    expect(slotKeysMatch(task({ after_anchor: 'LUNCH' }), 'lunch')).toBe(true);
  });

  it('does not match across distinct slots', () => {
    expect(slotKeysMatch(task({ paired_meal_name: 'Breakfast' }), 'lunch')).toBe(false);
    expect(slotKeysMatch(task({}), 'breakfast')).toBe(false);
  });
});
