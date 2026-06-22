import type { MealEntryRequest, PlannedMealEntryDto } from './planned-meal-entry';

export type { MealRefType } from './planned-meal-entry';

export type CarryoverDecision = 'carry' | 'defer' | 'drop';

export const DROP_REASONS = ['Changed priority', 'No longer needed', 'Too difficult', 'Not ready'] as const;
export type DropReason = typeof DROP_REASONS[number];
export type MealSlot = string;
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

// ── Agent API types ─────────────────────────────────────────────────────────

export interface SlotRef {
  date: string;
  meal_name: MealSlot;
}

export interface FailedSlot {
  date: string;
  meal_name: MealSlot;
  reason: string;
}

export interface MealPlanState {
  approved: MealEntry[];
  skipped: SlotRef[];
  custom: MealEntry[];
}

export interface MealEntry {
  date: string;
  meal_name: MealSlot;
  meal_ref: MealRef | null;
  title?: string;          // resolved server-side from meal_ref on responses; omitted on requests
  estimated_nutrition?: MealNutrition;
  estimated?: boolean;     // client-side only; never in API response
}

/**
 * Why a plan came back with no meals. Present only when the empty result is
 * actionable (currently: the user has no day-type/meal-anchor template), so the
 * client can show guidance instead of an unexplained empty grid.
 */
export type UnplannableReason = 'no_anchor_template';

export interface MealPlanResponse {
  plan_start: string;
  meals: MealEntry[];
  nutrition_summary?: { daily_avg_calories?: number };
  failed_slots?: FailedSlot[];
  unplannable_reason?: UnplannableReason;
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
  scheduled_start?: string; // "HH:MM"
  one_shot?: boolean;
  paired_meal_name?: string;
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
  dropReasons?: Record<string, DropReason>;
  savedAt: string;
}

export interface ScheduleEntryDto {
  entry_id: string;
  task_type: string;
  title?: string;
  date: string;
  scheduled_start?: string | null;
  status: string;
  after_anchor?: string;
  slot_meal_anchor_id?: string;
  duration_minutes?: number | null;
  energy_required?: string | null;
  one_shot?: boolean;
}

export type ScheduleAnchorKind =
  | 'meal'
  | 'scheduled_task'
  | 'start_of_day'
  | 'end_of_day'
  | 'timezone_change';

/** Unified anchor from GET /schedule/anchors (#958). Kind-specific fields are
 *  null unless they apply. `sequence` is the ordering primitive. */
export interface ScheduleAnchorDto {
  kind: ScheduleAnchorKind;
  sequence: number;
  time: string;                 // "HH:MM:SS"
  label: string;
  id: string | null;            // null only for start_of_day / end_of_day
  status: string | null;        // meal only
  consumed_at: string | null;   // meal only
  tolerance_minutes: number | null;
  sort_order: number | null;
  template_entry_id: string | null;
  zone: string | null;          // timezone_change only
}

export interface SchedulePeriodResponse {
  entries: ScheduleEntryDto[];
  carryover: ScheduleEntryDto[];
  planned_meals: PlannedMealEntryDto[];
}

export interface CarryoverApiResponse {
  carryover: ScheduleEntryDto[];
}

export interface PlanStatusResponse {
  planned: boolean;
  entry_count: number;
}

export interface PlanEntryRequest {
  date: string;
  task_type?: string;           // omit for meal anchor entries
  title?: string;
  // Wall-clock start for fixed-time tasks/meals. Omit (or null) for floating,
  // anchor-relative tasks — the backend stores a NULL scheduled_start and the day
  // view then keeps them in their `after_anchor` slot rather than reclassifying
  // them as a fixed scheduled_task. Mutually exclusive with a bare `after_anchor`.
  scheduled_start?: string | null; // "HH:MM"
  after_anchor?: string;
  duration_minutes?: number;
  energy_required?: EnergyLevel;
  one_shot?: boolean;
  /** 0-based order within (date, slot). */
  slot_position?: number;
  /** Pre-materialization meal pairing, resolved to slot_meal_anchor_id at commit. */
  paired_meal_name?: string;
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
  /** Slot anchor label for floating tasks — mutually exclusive with time_window_start. */
  after_anchor?: string;
  /** Exact start time "HH:MM" for fixed tasks — mutually exclusive with after_anchor. */
  time_window_start?: string;
  one_shot?: boolean;
  paired_meal_name?: string;
}

export interface PostSchedulePlanRequest {
  plan_start: string;
  plan_end: string;
  planning_task_id: string;
  entries: PlanEntryRequest[];
  replace?: boolean;
  /** Carryover decisions: entry_id → "carry" | "defer" | "drop" */
  carryover_decisions?: Record<string, CarryoverDecision>;
  /** Optional reasons for 'drop' decisions. entry_id → reason string */
  carryover_drop_reasons?: Record<string, DropReason>;
  placed_tasks?: PlanEntryRequest[];
  meal_entries: MealEntryRequest[];
}

export interface PostSchedulePlanResponse {
  committed: number;
  planning_task_status: string;
}
