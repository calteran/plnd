import { assembleScheduleItems, assembleSlotGroups } from './schedule-assembly';
import { isMealAnchor, MealAnchor, ScheduleTask } from '../models/schedule';
import { ScheduleAnchorDto, ScheduleAnchorKind, ScheduleEntryDto } from '../models/week-plan';
import { PlannedMealEntryDto } from '../models/planned-meal-entry';

let seq = 0;

function anchor(kind: ScheduleAnchorKind, label: string, id: string | null): ScheduleAnchorDto {
  return {
    kind, sequence: seq++, time: '08:00:00', label, id,
    status: kind === 'meal' ? 'planned' : null, consumed_at: null,
    tolerance_minutes: null, sort_order: null, template_entry_id: null, zone: null,
  };
}

function entry(p: Partial<ScheduleEntryDto> & { entry_id: string }): ScheduleEntryDto {
  return {
    task_type: 'general', title: 'Task', date: '2026-06-16', status: 'pending', ...p,
  } as ScheduleEntryDto;
}

beforeEach(() => { seq = 0; });

describe('assembleScheduleItems', () => {
  it('places a floating task in the start-of-day slot (above the first meal)', () => {
    const anchors = [
      anchor('start_of_day', 'start of day', null),
      anchor('meal', 'Breakfast', 'meal-1'),
      anchor('end_of_day', 'end of day', null),
    ];
    const entries = [entry({ entry_id: 't1', title: 'Meds', after_anchor: 'start of day' })];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.map(i => isMealAnchor(i) ? `meal:${i.name}` : `task:${i.label}`))
      .toEqual(['task:Meds', 'meal:Breakfast']);
  });

  it('renders a scheduled task once, as its own row at its sequence position', () => {
    const anchors = [
      anchor('meal', 'Breakfast', 'meal-1'),
      anchor('scheduled_task', 'Standup', 'sched-1'),
    ];
    const entries = [entry({ entry_id: 'sched-1', title: 'Standup', scheduled_start: '09:00' })];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(2);
    const task = items[1] as ScheduleTask;
    expect(task.label).toBe('Standup');
    expect(task.scheduledStart).toBe('09:00');
    expect(task.floating).toBeFalse();
  });

  it('treats an entry with both scheduled_start and after_anchor as a scheduled task (own row, not floating)', () => {
    const anchors = [
      anchor('scheduled_task', 'Standup', 'sched-1'),
      anchor('meal', 'Lunch', 'meal-2'),
    ];
    const entries = [
      entry({ entry_id: 'sched-1', title: 'Standup', scheduled_start: '09:00', after_anchor: 'Standup' }),
    ];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(2);
    const task = items[0] as ScheduleTask;
    expect(task.label).toBe('Standup');
    expect(task.scheduledStart).toBe('09:00');
    expect(task.floating).toBeFalse();
  });

  it('interleaves a floating task into the slot after a scheduled-task anchor', () => {
    const anchors = [
      anchor('scheduled_task', 'Standup', 'sched-1'),
      anchor('meal', 'Lunch', 'meal-2'),
    ];
    const entries = [
      entry({ entry_id: 'sched-1', title: 'Standup', scheduled_start: '09:00' }),
      entry({ entry_id: 't2', title: 'Email', after_anchor: 'Standup' }),
    ];
    const labels = assembleScheduleItems(anchors, entries, [])
      .map(i => isMealAnchor(i) ? `meal:${i.name}` : `task:${(i as ScheduleTask).label}`);
    expect(labels).toEqual(['task:Standup', 'task:Email', 'meal:Lunch']);
  });

  it('nests during-meal tasks inside their meal row (slot_meal_anchor_id)', () => {
    const anchors = [anchor('meal', 'Breakfast', 'meal-1')];
    const entries = [entry({ entry_id: 't3', title: 'Vitamins', slot_meal_anchor_id: 'meal-1' })];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(1);
    const meal = items[0] as MealAnchor;
    expect(meal.duringMealTasks.map(t => t.label)).toEqual(['Vitamins']);
  });

  it('binds a planned meal title to its meal anchor', () => {
    const anchors = [anchor('meal', 'Breakfast', 'meal-1')];
    const planned: PlannedMealEntryDto[] = [
      { meal_anchor_instance_id: 'meal-1', title: 'Avocado toast' } as PlannedMealEntryDto,
    ];
    const meal = assembleScheduleItems(anchors, [], planned)[0] as MealAnchor;
    expect(meal.description).toBe('Avocado toast');
  });

  it('preserves backend sequence order across a midnight-crossing day (no client re-sort)', () => {
    // The backend linearizes a night-shift day as Dinner(21:00) → Midnight snack(01:00)
    // → Breakfast(08:00). Clock times are non-monotonic; the client must follow the
    // given `sequence`/array order and never re-sort by `time`.
    const dinner = anchor('meal', 'Dinner', 'm-dinner'); dinner.time = '21:00:00';
    const snack  = anchor('meal', 'Midnight snack', 'm-snack'); snack.time = '01:00:00';
    const bfast  = anchor('meal', 'Breakfast', 'm-bfast'); bfast.time = '08:00:00';
    const labels = assembleScheduleItems([dinner, snack, bfast], [], [])
      .map(i => (i as MealAnchor).name);
    expect(labels).toEqual(['Dinner', 'Midnight snack', 'Breakfast']);
  });

  it('renders an unmatched floating task at the top instead of dropping it', () => {
    const anchors = [anchor('meal', 'Breakfast', 'meal-1')];
    const entries = [entry({ entry_id: 't4', title: 'Orphan', after_anchor: 'Dinner' })];
    const warn = spyOn(console, 'warn');
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(2);
    expect((items[0] as ScheduleTask).label).toBe('Orphan');
    expect(warn).toHaveBeenCalled();
  });
});

describe('assembleSlotGroups', () => {
  it('groups floating tasks into slots after their anchor, in arrival order', () => {
    const anchors = [
      anchor('start_of_day', 'start of day', null),
      anchor('meal', 'lunch', 'meal-1'),
    ];
    const entries = [
      entry({ entry_id: 't1', task_type: 'work', title: 'first', after_anchor: 'lunch' }),
      entry({ entry_id: 't2', task_type: 'work', title: 'second', after_anchor: 'lunch' }),
    ];

    const groups = assembleSlotGroups(anchors, entries, []);
    const lunch = groups.find(g => g.anchorLabel === 'lunch')!;
    expect(lunch.tasks.map(t => t.label)).toEqual(['first', 'second']);
  });

  it('emits one SlotGroup per anchor in sequence order', () => {
    const anchors = [
      anchor('start_of_day', 'start of day', null),
      anchor('meal', 'breakfast', 'meal-1'),
      anchor('meal', 'lunch', 'meal-2'),
    ];

    const groups = assembleSlotGroups(anchors, [], []);
    expect(groups.map(g => g.anchorLabel)).toEqual(['start of day', 'breakfast', 'lunch']);
  });

  it('assigns null anchor for start-of-day slot and MealAnchor for meal slots', () => {
    const anchors = [
      anchor('start_of_day', 'start of day', null),
      anchor('meal', 'lunch', 'meal-1'),
    ];

    const groups = assembleSlotGroups(anchors, [], []);
    const startOfDay = groups.find(g => g.anchorLabel === 'start of day')!;
    const lunch = groups.find(g => g.anchorLabel === 'lunch')!;
    expect(startOfDay.anchor).toBeNull();
    expect(lunch.anchor).not.toBeNull();
    expect((lunch.anchor as MealAnchor).name).toBe('Lunch');
  });
});
