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
  title?: string;          // client-side only; never in API response
  estimated_nutrition?: MealNutrition;
  estimated?: boolean;     // client-side only; never in API response
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

export interface RoutineTemplateInput {
  title: string;
  task_type: string;
  recurrence_rule: string;
  duration_minutes: number;
  energy_required: EnergyLevel;
  time_window_start?: string;
  time_window_end?: string;
}

export interface PlaceTasksRequest {
  task_names: string[];
  routine_templates: RoutineTemplateInput[];
  plan_start: string; // ISO date
  plan_end: string;   // ISO date
}

export interface PlaceTasksEntry {
  title: string;
  scheduled_date: string; // ISO date
  task_type: string;
  duration_minutes: number;
  energy_required: EnergyLevel;
  /** Meal anchor for floating tasks — mutually exclusive with time_window_start. */
  after_milepost?: string;
  /** Exact start time "HH:MM" for fixed tasks — mutually exclusive with after_milepost. */
  time_window_start?: string;
}

export interface PostSchedulePlanRequest {
  plan_start: string;
  plan_end: string;
  planning_task_id: string;
  entries: PlanEntryRequest[];
  replace?: boolean;
  /** Carryover decisions: entry_id → "defer" | "dismiss" | "accept" */
  carryover_decisions?: Record<string, CarryoverDecision>;
  placed_tasks?: PlanEntryRequest[];
  meal_habit_ids?: string[];
}

export interface PostSchedulePlanResponse {
  committed: number;
  planning_task_status: string;
}
