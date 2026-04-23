export type CarryoverDecision = 'defer' | 'dismiss' | 'accept';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type EnergyLevel = 'low' | 'medium' | 'high';
export type ApprovalState = 'proposed' | 'approved' | 'skipped';

export interface CarryoverItem {
  entry_id: string;
  title: string | null;
  task_type: string;
  date: string;
  status: string;
}

export interface MealRef {
  type: 'catalog' | 'user';
  id: string;
}

export interface MealNutrition {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

export interface PlannedMeal {
  approvalState: ApprovalState;
  mealRef: MealRef | null;
  title: string;
  nutrition?: MealNutrition;
  estimated?: boolean;
}

/** The three standard meal slots that are auto-filled. Snack is excluded — it is only included when explicitly set via setMeal. */
export const STANDARD_MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

// ── Agent API types ─────────────────────────────────────────────────────────

export interface MealPlanStateEntry {
  date: string;
  occasion: MealSlot;
  meal_ref?: MealRef | null;
  title?: string;
  approved: boolean;
  skipped: boolean;
}

export interface MealPlanState {
  week_start: string;
  meals: MealPlanStateEntry[];
}

export interface MealEntry {
  date: string;
  occasion: MealSlot;
  meal_ref: MealRef | null;
  title: string;
  estimated_nutrition?: MealNutrition;
  estimated?: boolean;
}

export interface MealPlanResponse {
  plan_start: string;
  meals: MealEntry[];
  nutrition_summary?: { daily_avg_calories?: number };
}

export interface ResolveResponse {
  meal_ref: MealRef | null;
  estimated_nutrition?: MealNutrition;
  confirmation: string;
}

// ── Planning types ──────────────────────────────────────────────────────────

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
  schemaVersion: 2;
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
  duration_minutes?: number;
  energy_required?: EnergyLevel;
}

// -- Task Placement ----------------------------------------------------------

export interface PlaceTasksRequest {
  task_names: string[];
  plan_start: string; // ISO date
  plan_end: string;   // ISO date
}

export interface PlaceTasksEntry {
  title: string;
  scheduled_date: string; // ISO date
  time_window_start: string; // "HH:MM"
  duration_minutes: number;
  energy_required: EnergyLevel;
  task_type: string;
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
