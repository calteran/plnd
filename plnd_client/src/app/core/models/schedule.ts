import { MealNutrition } from './week-plan';

export type ItemStatus = 'pending' | 'done';
export type ItemType   = 'task' | 'exercise' | 'appointment';

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

export function isMealAnchor(item: ScheduleItem): item is MealAnchor {
  return 'emoji' in item;
}
