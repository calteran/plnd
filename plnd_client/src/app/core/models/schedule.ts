import { MealNutrition } from './week-plan';

export type ItemStatus = 'pending' | 'done';
export type ItemType   = 'work' | 'exercise' | 'leisure' | 'medication' | 'appointment' | 'general';

export interface ScheduleTask {
  id: string;
  type: ItemType;
  label: string;
  status: ItemStatus;
  scheduledTime?: string; // e.g. '11 AM'
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

export function parseItemType(value: string | null | undefined): ItemType {
  if (value && ITEM_TYPES.has(value as ItemType)) return value as ItemType;
  return 'general';
}

export function isMealAnchor(item: ScheduleItem): item is MealAnchor {
  return 'emoji' in item;
}
