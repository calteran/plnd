import { MealNutrition, EnergyLevel } from './week-plan';

export type ItemStatus = 'pending' | 'done';
export type ItemType   = 'work' | 'exercise' | 'leisure' | 'medication' | 'appointment' | 'general';

export interface ScheduleTask {
  id: string;
  type: ItemType;
  label: string;
  status: ItemStatus;
  scheduledTime?: string;     // gutter display (unchanged; still unpopulated for tasks)
  scheduledStart?: string;    // editable "HH:MM" (wall-clock); undefined for floating tasks
  durationMinutes?: number;
  energy?: EnergyLevel;
  oneShot: boolean;
  floating: boolean;          // true when placed in a slot (after_anchor) with no fixed time
}

/** Partial edit emitted by the task-edit form; mirrors PatchEntryRequest. */
export interface TaskEditPatch {
  title?: string;
  type?: ItemType;
  scheduledStart?: string;    // "HH:MM"
  durationMinutes?: number;
  energy?: EnergyLevel;
  oneShot?: boolean;
}

export interface MealAnchor {
  id: string;
  name: string;           // 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
  emoji: string;
  description?: string;   // dish name, e.g. 'Avocado toast + eggs'
  status: 'done' | 'planned' | 'unplanned' | 'skipped';
  duringMealTasks: ScheduleTask[];
  nutrition?: MealNutrition;
  estimated?: boolean;
}

export type ScheduleItem = ScheduleTask | MealAnchor;

const ITEM_TYPES: ReadonlySet<ItemType> = new Set(['work', 'exercise', 'leisure', 'medication', 'appointment', 'general']);

export function parseItemType(value: string | undefined): ItemType {
  if (value && ITEM_TYPES.has(value as ItemType)) return value as ItemType;
  return 'general';
}

export function isMealAnchor(item: ScheduleItem): item is MealAnchor {
  return 'emoji' in item;
}
