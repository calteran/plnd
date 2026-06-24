import { describe, it, expect } from 'vitest';
import {
  stepWithinDay, resolveDayJump, describeMove, describeDayJump, DayLayout,
} from './reorder-navigation';

const layout: DayLayout = [
  { slotKey: 'start of day', kind: 'slot', taskIds: ['a', 'b'] },
  { slotKey: 'meal-1',       kind: 'meal', taskIds: [] },          // empty pairing
  { slotKey: 'breakfast',    kind: 'slot', taskIds: ['c'] },
];

describe('stepWithinDay', () => {
  it('reorders within a slot (down)', () => {
    expect(stepWithinDay(layout, 'a', 'down'))
      .toEqual({ slotKey: 'start of day', kind: 'slot', index: 1, crossing: 'same-slot' });
  });

  it('reorders within a slot (up)', () => {
    expect(stepWithinDay(layout, 'b', 'up'))
      .toEqual({ slotKey: 'start of day', kind: 'slot', index: 0, crossing: 'same-slot' });
  });

  it('returns null at the very first position (up)', () => {
    expect(stepWithinDay(layout, 'a', 'up')).toBeNull();
  });

  it('returns null at the very last position (down)', () => {
    expect(stepWithinDay(layout, 'c', 'down')).toBeNull();
  });

  it('steps down out of the bottom of a slot into an empty meal pairing (into-meal)', () => {
    expect(stepWithinDay(layout, 'b', 'down'))
      .toEqual({ slotKey: 'meal-1', kind: 'meal', index: 0, crossing: 'into-meal' });
  });

  it('steps up from the top of a slot into the previous (empty) meal pairing — at its end', () => {
    // 'c' is top of 'breakfast'; previous slot is the empty meal pairing.
    expect(stepWithinDay(layout, 'c', 'up'))
      .toEqual({ slotKey: 'meal-1', kind: 'meal', index: 0, crossing: 'into-meal' });
  });

  it('steps out of a meal pairing into the next slot (out-of-meal)', () => {
    const withMealTask: DayLayout = [
      { slotKey: 'meal-1', kind: 'meal', taskIds: ['m'] },
      { slotKey: 'breakfast', kind: 'slot', taskIds: ['c'] },
    ];
    expect(stepWithinDay(withMealTask, 'm', 'down'))
      .toEqual({ slotKey: 'breakfast', kind: 'slot', index: 0, crossing: 'out-of-meal' });
  });

  it('steps between two plain slots (to-slot)', () => {
    const twoSlots: DayLayout = [
      { slotKey: 'start of day', kind: 'slot', taskIds: ['a'] },
      { slotKey: 'breakfast', kind: 'slot', taskIds: ['c'] },
    ];
    expect(stepWithinDay(twoSlots, 'a', 'down'))
      .toEqual({ slotKey: 'breakfast', kind: 'slot', index: 0, crossing: 'to-slot' });
  });

  it('returns null for an unknown task id', () => {
    expect(stepWithinDay(layout, 'zzz', 'down')).toBeNull();
  });
});

describe('resolveDayJump', () => {
  it('keeps the slot key when the target day has it', () => {
    expect(resolveDayJump('breakfast', ['<sched>', 'breakfast', 'lunch'])).toBe('breakfast');
  });
  it('falls back to <sched> when the target day lacks the slot', () => {
    expect(resolveDayJump('brunch', ['<sched>', 'lunch'])).toBe('<sched>');
  });
});

describe('describeMove / describeDayJump', () => {
  it('announces same-slot direction', () => {
    expect(describeMove({ crossing: 'same-slot', dir: 'up' })).toBe('Moved up');
    expect(describeMove({ crossing: 'same-slot', dir: 'down' })).toBe('Moved down');
  });
  it('announces into / out of a meal by label', () => {
    expect(describeMove({ crossing: 'into-meal', dir: 'up', targetLabel: 'Breakfast' }))
      .toBe('Moved into Breakfast');
    expect(describeMove({ crossing: 'out-of-meal', dir: 'down', sourceLabel: 'Breakfast' }))
      .toBe('Moved out of Breakfast');
  });
  it('announces a to-slot move by target label', () => {
    expect(describeMove({ crossing: 'to-slot', dir: 'down', targetLabel: 'after Lunch' }))
      .toBe('Moved to after Lunch');
  });
  it('announces a day jump with and without a slot label', () => {
    expect(describeDayJump({ dayLabel: 'Tuesday', targetLabel: 'after Breakfast' }))
      .toBe('Moved to Tuesday, after Breakfast');
    expect(describeDayJump({ dayLabel: 'Tuesday' }))
      .toBe('Moved to Tuesday, unanchored');
  });
});
