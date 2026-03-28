import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { ConfigService } from './config.service';
import {
  CarryoverDecision, MealSlot, PlanDraftShape,
  PlanEntryRequest, PlannedMeal, PlannedTask, FloatingTask,
  PostSchedulePlanRequest, PostSchedulePlanResponse,
  PlanStatusResponse, SchedulePeriodResponse, getMockSuggestion,
  SKIP_SENTINEL, STANDARD_MEAL_SLOTS,
} from '../models/week-plan';

interface WeeklyPlanTaskResponse { task_id: string; }

@Injectable({ providedIn: 'root' })
export class WeekPlanService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  private readonly DRAFT_KEY = 'plnd:plan-draft';
  private readonly SCHEMA_VERSION = 1;

  private readonly planStartSignal = signal<string>('');
  private readonly planEndSignal = signal<string>('');
  private readonly currentStepSignal = signal<number>(1);
  private readonly carryoverItemsSignal = signal<SchedulePeriodResponse['carryover']>([]);
  private readonly scheduledTasksSignal = signal<PlannedTask[]>([]);
  private readonly scheduledMealsSignal = signal<Record<string, Partial<Record<MealSlot, PlannedMeal>>>>({});
  private readonly carryoverDecisionsSignal = signal<Record<string, CarryoverDecision>>({});
  private readonly hasUnplannedHorizonSignal = signal<boolean>(false);
  private readonly isSubmittingSignal = signal<boolean>(false);
  private readonly planningTaskIdSignal = signal<string>('');
  private readonly floatingTasksSignal = signal<FloatingTask[]>([]);

  readonly planStart = this.planStartSignal.asReadonly();
  readonly planEnd = this.planEndSignal.asReadonly();
  readonly currentStep = this.currentStepSignal.asReadonly();
  readonly carryoverItems = this.carryoverItemsSignal.asReadonly();
  readonly scheduledTasks = this.scheduledTasksSignal.asReadonly();
  readonly scheduledMeals = this.scheduledMealsSignal.asReadonly();
  readonly carryoverDecisions = this.carryoverDecisionsSignal.asReadonly();
  readonly hasUnplannedHorizon = this.hasUnplannedHorizonSignal.asReadonly();
  readonly isSubmitting = this.isSubmittingSignal.asReadonly();
  readonly planningTaskId = this.planningTaskIdSignal.asReadonly();
  readonly floatingTasks = this.floatingTasksSignal.asReadonly();

  initSession(start: string, end: string): void {
    this.planStartSignal.set(start);
    this.planEndSignal.set(end);
    const draft = this.loadDraft();
    if (draft && draft.planStart === start && draft.planEnd === end) {
      this.currentStepSignal.set(draft.currentStep);
      this.carryoverDecisionsSignal.set(draft.carryoverDecisions);
      this.scheduledMealsSignal.set(draft.scheduledMeals);
      this.scheduledTasksSignal.set(draft.scheduledTasks);
      this.floatingTasksSignal.set(draft.floatingTasks ?? []);
    } else {
      this.currentStepSignal.set(1);
      this.carryoverDecisionsSignal.set({});
      this.scheduledMealsSignal.set({});
      this.scheduledTasksSignal.set([]);
      this.floatingTasksSignal.set([]);
    }
  }

  goToStep(step: number): void {
    this.currentStepSignal.set(step);
    this.saveDraft();
  }

  saveDraft(): void {
    const draft: PlanDraftShape = {
      schemaVersion: 1,
      planStart: this.planStartSignal(),
      planEnd: this.planEndSignal(),
      currentStep: this.currentStepSignal(),
      carryoverDecisions: this.carryoverDecisionsSignal(),
      scheduledMeals: this.scheduledMealsSignal(),
      scheduledTasks: this.scheduledTasksSignal(),
      floatingTasks: this.floatingTasksSignal(),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(this.DRAFT_KEY, JSON.stringify(draft));
  }

  loadDraft(): PlanDraftShape | null {
    try {
      const raw = localStorage.getItem(this.DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PlanDraftShape;
      if (parsed.schemaVersion !== this.SCHEMA_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  clearDraft(): void {
    localStorage.removeItem(this.DRAFT_KEY);
  }

  loadPeriod(start: string, end: string): Observable<SchedulePeriodResponse> {
    return this.http
      .get<SchedulePeriodResponse>(`${this.apiBase}/schedule/period?start=${start}&end=${end}`)
      .pipe(tap(resp => {
        this.carryoverItemsSignal.set(resp.carryover);
        // Populate plan state from server entries when no local draft is loaded.
        // This supports re-plan mode (spec §298): existing entries pre-fill the wizard
        // so the user edits the current plan rather than starting from scratch.
        if (
          this.scheduledTasksSignal().length === 0 &&
          Object.keys(this.scheduledMealsSignal()).length === 0
        ) {
          const tasks: PlannedTask[] = [];
          const meals: Record<string, Partial<Record<MealSlot, PlannedMeal>>> = {};
          for (const entry of resp.entries) {
            if (entry.task_type === 'meal' && entry.after_milepost) {
              const slot = entry.after_milepost as MealSlot;
              meals[entry.date] ??= {};
              meals[entry.date][slot] = {
                type: entry.task_ref_type === 'user_meal' ? 'user_meal' : 'mock',
                id: entry.task_ref_id,
                title: entry.title ?? slot,
              };
            } else {
              tasks.push({
                date: entry.date,
                title: entry.title ?? entry.task_type,
                energy: 'medium',
                task_type: entry.task_type,
                task_ref_id: entry.task_ref_id,
                task_ref_type: entry.task_ref_type,
                scheduled_start: entry.scheduled_start ? utcHHMM(entry.scheduled_start) : undefined,
              });
            }
          }
          if (tasks.length) this.scheduledTasksSignal.set(tasks);
          if (Object.keys(meals).length) this.scheduledMealsSignal.set(meals);
        }
      }));
  }

  checkPlanStatus(start: string, end: string): void {
    this.http
      .get<PlanStatusResponse>(`${this.apiBase}/schedule/plan/status?start=${start}&end=${end}`)
      .subscribe({
        next: resp => this.hasUnplannedHorizonSignal.set(!resp.planned),
        error: () => {},
      });
  }

  commitPlan(taskId: string, replace = false): Observable<PostSchedulePlanResponse> {
    this.isSubmittingSignal.set(true);
    const req = this.buildCommitRequest(taskId, replace);
    return this.http.post<PostSchedulePlanResponse>(`${this.apiBase}/schedule/plan`, req).pipe(
      tap(() => {
        this.clearDraft();
        this.hasUnplannedHorizonSignal.set(false);
        this.isSubmittingSignal.set(false);
      }),
      catchError(err => {
        this.isSubmittingSignal.set(false);
        return throwError(() => err);
      })
    );
  }

  /** Calls POST /tasks/weekly-plan to create or fetch the planning task for the horizon. */
  createOrFetchPlanTask(planStart: string): Observable<WeeklyPlanTaskResponse> {
    return this.http
      .post<WeeklyPlanTaskResponse>(`${this.apiBase}/tasks/weekly-plan?plan_start=${planStart}`, {})
      .pipe(tap(resp => this.planningTaskIdSignal.set(resp.task_id)));
  }

  setCarryoverDecision(entryId: string, decision: CarryoverDecision): void {
    this.carryoverDecisionsSignal.update(d => ({ ...d, [entryId]: decision }));
  }

  setMeal(date: string, slot: MealSlot, meal: PlannedMeal): void {
    this.scheduledMealsSignal.update(m => ({
      ...m,
      [date]: { ...(m[date] ?? {}), [slot]: meal },
    }));
  }

  clearMeal(date: string, slot: MealSlot): void {
    this.scheduledMealsSignal.update(m => {
      const day = { ...(m[date] ?? {}) };
      delete day[slot];
      return { ...m, [date]: day };
    });
  }

  addTask(task: PlannedTask): void {
    this.scheduledTasksSignal.update(t => [...t, task]);
  }

  removeTask(index: number): void {
    this.scheduledTasksSignal.update(t => t.filter((_, i) => i !== index));
  }

  addFloatingTask(task: FloatingTask): void {
    this.floatingTasksSignal.update(tasks => [...tasks, task]);
  }

  removeFloatingTask(index: number): void {
    this.floatingTasksSignal.update(tasks => tasks.filter((_, i) => i !== index));
  }

  /** Days in the horizon as ISO date strings (inclusive). Reactive: re-evaluates when planStart/planEnd change. */
  readonly horizonDays = computed(() => {
    const start = this.planStartSignal();
    const end = this.planEndSignal();
    if (!start || !end) return [];
    // Parse as local-noon to avoid UTC-offset day rollback
    const cur = new Date(`${start}T12:00:00`);
    const endDate = new Date(`${end}T12:00:00`);
    const days: string[] = [];
    while (cur <= endDate) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  });

  clear(): void {
    this.planStartSignal.set('');
    this.planEndSignal.set('');
    this.currentStepSignal.set(1);
    this.carryoverItemsSignal.set([]);
    this.scheduledTasksSignal.set([]);
    this.scheduledMealsSignal.set({});
    this.carryoverDecisionsSignal.set({});
    this.hasUnplannedHorizonSignal.set(false);
    this.isSubmittingSignal.set(false);
    this.planningTaskIdSignal.set('');
    this.floatingTasksSignal.set([]);
  }

  private buildCommitRequest(taskId: string, replace: boolean): PostSchedulePlanRequest {
    const meals = this.scheduledMealsSignal();
    const tasks = this.scheduledTasksSignal();
    const entries: PlanEntryRequest[] = [];

    // Resolve all horizon day × standard slot combinations.
    // Pending (no entry) → implicit acceptance via getMockSuggestion.
    // __skipped__ sentinel → omit from request.
    // Non-standard slots (e.g. snack) are never auto-filled; include them only if explicitly set.
    for (const date of this.horizonDays()) {
      for (const slot of STANDARD_MEAL_SLOTS) {
        const meal = meals[date]?.[slot];
        if (meal?.title === SKIP_SENTINEL) continue;
        const resolved: PlannedMeal = meal ?? { type: 'mock', title: getMockSuggestion(date, slot) };
        entries.push({
          date,
          task_type: 'meal',
          task_ref_id: resolved.type === 'user_meal' ? resolved.id : undefined,
          task_ref_type: resolved.type === 'user_meal' ? 'user_meal' : undefined,
          title: resolved.type === 'mock' || !resolved.id ? resolved.title : undefined,
          scheduled_start: slotDefaultTime(slot),
          after_milepost: slot,
        });
      }
      // Explicit non-standard slots (snack, etc.) — include only what was explicitly set.
      for (const [slotKey, meal] of Object.entries(meals[date] ?? {})) {
        const slot = slotKey as MealSlot;
        if (STANDARD_MEAL_SLOTS.includes(slot) || !meal || meal.title === SKIP_SENTINEL) continue;
        entries.push({
          date,
          task_type: 'meal',
          task_ref_id: meal.type === 'user_meal' ? meal.id : undefined,
          task_ref_type: meal.type === 'user_meal' ? 'user_meal' : undefined,
          title: meal.type === 'mock' || !meal.id ? meal.title : undefined,
          scheduled_start: slotDefaultTime(slot),
          after_milepost: slot,
        });
      }
    }

    for (const task of tasks) {
      entries.push({
        date: task.date,
        task_type: task.task_type ?? 'custom',
        task_ref_id: task.task_ref_id,
        task_ref_type: task.task_ref_type,
        title: task.title,
        scheduled_start: task.scheduled_start ?? '09:00',
      });
    }

    return {
      plan_start: this.planStartSignal(),
      plan_end: this.planEndSignal(),
      planning_task_id: taskId,
      entries,
      replace: replace || undefined,
      carryover_decisions: this.carryoverDecisionsSignal(),
    };
  }
}

/** Extracts "HH:MM" from an ISO timestamp string using UTC hours/minutes. */
function utcHHMM(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

function slotDefaultTime(slot: MealSlot): string {
  const map: Record<MealSlot, string> = {
    breakfast: '08:00',
    lunch: '12:00',
    dinner: '18:00',
    snack: '15:00',
  };
  return map[slot];
}
