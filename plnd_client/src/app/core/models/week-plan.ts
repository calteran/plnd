export type CarryoverDecision = 'defer' | 'dismiss' | 'accept';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type EnergyLevel = 'low' | 'medium' | 'high';

export interface CarryoverItem {
  entry_id: string;
  title: string | null;
  task_type: string;
  date: string;
  status: string;
}

export interface PlannedMeal {
  type: 'user_meal' | 'mock';
  id?: string;
  title: string;
}

/** Sentinel value stored as PlannedMeal.title when the user has explicitly skipped a slot. */
export const SKIP_SENTINEL = '__skipped__';

export interface PlannedTask {
  date: string;
  title: string;
  duration?: number;
  energy: EnergyLevel;
  task_type?: string;
  task_ref_id?: string;
  task_ref_type?: string;
  scheduled_start?: string; // "HH:MM"
}

export type FloatingTask = Omit<PlannedTask, 'date'>;

export interface PlanDraftShape {
  schemaVersion: 1;
  planStart: string;
  planEnd: string;
  currentStep: number;
  carryoverDecisions: Record<string, CarryoverDecision>;
  scheduledMeals: Record<string, Partial<Record<MealSlot, PlannedMeal>>>;
  scheduledTasks: PlannedTask[];
  floatingTasks?: FloatingTask[];
  savedAt: string;
}

export interface ScheduleEntryDto {
  entry_id: string;
  task_type: string;
  task_ref_id?: string;
  task_ref_type?: string;
  title?: string;
  date: string;
  scheduled_start: string;
  status: string;
  after_milepost?: string;
}

export interface SchedulePeriodResponse {
  entries: ScheduleEntryDto[];
  carryover: ScheduleEntryDto[];
}

export interface PlanStatusResponse {
  planned: boolean;
  entry_count: number;
}

export interface PlanEntryRequest {
  date: string;
  task_type: string;
  task_ref_id?: string;
  task_ref_type?: string;
  title?: string;
  scheduled_start: string; // "HH:MM"
  after_milepost?: string;
}

export interface PostSchedulePlanRequest {
  plan_start: string;
  plan_end: string;
  planning_task_id: string;
  entries: PlanEntryRequest[];
  replace?: boolean;
  /** Carryover decisions: entry_id → "defer" | "dismiss" | "accept" */
  carryover_decisions?: Record<string, CarryoverDecision>;
}

export interface PostSchedulePlanResponse {
  committed: number;
  planning_task_status: string;
}

export const MOCK_MEAL_SUGGESTIONS: string[] = [
  'Oatmeal', 'Scrambled Eggs', 'Yogurt & Fruit',
  'Salad', 'Sandwich', 'Soup',
  'Pasta', 'Stir Fry', 'Grilled Chicken',
  'Smoothie', 'Leftovers',
];

// TODO(phase-3): replace mock array with WeekPlanService.getMealSuggestions()
export function getMockSuggestion(date: string, slot: MealSlot): string {
  const hash = date.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const slotIndex = ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(slot);
  return MOCK_MEAL_SUGGESTIONS[(hash + slotIndex) % MOCK_MEAL_SUGGESTIONS.length];
}
