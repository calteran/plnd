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

/** A meal or dish returned by GET /my/meal-suggestions. */
export interface MealSuggestion {
  id:              string;
  name:            string;
  /** "meal" or "dish" */
  suggestion_type: string;
}

/** The three standard meal slots that are auto-filled with suggestions. Snack is excluded — it is only included when explicitly set via setMeal. */
export const STANDARD_MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

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

