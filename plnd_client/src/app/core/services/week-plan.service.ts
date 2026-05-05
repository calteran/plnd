import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, noop, of, switchMap, tap, throwError } from 'rxjs';
import { ConfigService } from './config.service';
import {
  CarryoverApiResponse, CarryoverDecision, DropReason, MealEntry, MealNutrition, MealPlanState, MealRef,
  MealSlot, PlanDraftShape, PlanEntryRequest, PlannedMeal, PlannedTask, FloatingTask,
  PostSchedulePlanRequest, PostSchedulePlanResponse,
  PlanStatusResponse, ScheduleEntryDto, SchedulePeriodResponse,
} from '../models/week-plan';
import { TaskType } from '../models/routine';
import { MealPatternService } from './meal-pattern.service';
import { preferredTimeHHMM } from '../models/meal-pattern';

interface WeeklyPlanTaskResponse { task_id: string; }

@Injectable({ providedIn: 'root' })
export class WeekPlanService {
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;
  private readonly mealPatternService = inject(MealPatternService);

  private readonly DRAFT_KEY = 'plnd:plan-draft';
  private readonly SCHEMA_VERSION = 2;

  private readonly planStartSignal            = signal<string>('');
  private readonly planEndSignal              = signal<string>('');
  private readonly currentStepSignal          = signal<number>(1);
  private readonly carryoverItemsSignal       = signal<ScheduleEntryDto[]>([]);
  private readonly scheduledTasksSignal       = signal<PlannedTask[]>([]);
  private readonly scheduledMealsSignal       = signal<Record<string, Partial<Record<MealSlot, PlannedMeal>>>>({});
  private readonly carryoverDecisionsSignal   = signal<Record<string, CarryoverDecision>>({});
  private readonly dropReasonsSignal          = signal<Record<string, DropReason>>({});
  private readonly hasUnplannedHorizonSignal  = signal<boolean>(false);
  private readonly isSubmittingSignal         = signal<boolean>(false);
  private readonly planningTaskIdSignal       = signal<string>('');
  private readonly floatingTasksSignal        = signal<FloatingTask[]>([]);
  private readonly isGeneratingSignal         = signal<boolean>(false);

  readonly planStart            = this.planStartSignal.asReadonly();
  readonly planEnd              = this.planEndSignal.asReadonly();
  readonly currentStep          = this.currentStepSignal.asReadonly();
  readonly carryoverItems       = this.carryoverItemsSignal.asReadonly();
  readonly scheduledTasks       = this.scheduledTasksSignal.asReadonly();
  readonly scheduledMeals       = this.scheduledMealsSignal.asReadonly();
  readonly carryoverDecisions   = this.carryoverDecisionsSignal.asReadonly();
  readonly dropReasons          = this.dropReasonsSignal.asReadonly();
  readonly hasUnplannedHorizon  = this.hasUnplannedHorizonSignal.asReadonly();
  readonly isSubmitting         = this.isSubmittingSignal.asReadonly();
  readonly planningTaskId       = this.planningTaskIdSignal.asReadonly();
  readonly floatingTasks        = this.floatingTasksSignal.asReadonly();
  readonly isGenerating         = this.isGeneratingSignal.asReadonly();

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
      if (draft.dropReasons) this.dropReasonsSignal.set(draft.dropReasons);
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
      schemaVersion: 2,
      planStart: this.planStartSignal(),
      planEnd: this.planEndSignal(),
      currentStep: this.currentStepSignal(),
      carryoverDecisions: this.carryoverDecisionsSignal(),
      scheduledMeals: this.scheduledMealsSignal(),
      scheduledTasks: this.scheduledTasksSignal(),
      floatingTasks: this.floatingTasksSignal(),
      dropReasons: this.dropReasonsSignal(),
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

  // Retained for re-plan mode: pre-fills scheduled tasks/meals from existing period entries.
  loadPeriod(start: string, end: string): Observable<SchedulePeriodResponse> {
    return this.http
      .get<SchedulePeriodResponse>(`${this.apiBase}/schedule/period?start=${start}&end=${end}`)
      .pipe(tap(resp => {
        this.carryoverItemsSignal.set(resp.carryover);
        // Populate plan state from server entries when no local draft is loaded.
        // This supports re-plan mode: existing entries pre-fill the wizard.
        if (
          this.scheduledTasksSignal().length === 0 &&
          Object.keys(this.scheduledMealsSignal()).length === 0
        ) {
          const tasks: PlannedTask[] = [];
          const meals: Record<string, Partial<Record<MealSlot, PlannedMeal>>> = {};
          for (const entry of resp.entries) {
            if (entry.task_type == null && entry.after_anchor) {
              const slot = entry.after_anchor as MealSlot;
              meals[entry.date] ??= {};
              meals[entry.date][slot] = {
                approvalState: 'approved',
                mealRef: entry.task_ref_id
                  ? { type: (entry.task_ref_type ?? 'user') as 'catalog' | 'user', id: entry.task_ref_id }
                  : null,
                title: entry.title ?? slot,
              };
            } else {
              tasks.push({
                date: entry.date,
                title: entry.title ?? entry.task_type ?? '',
                energy: 'medium',
                task_type: entry.task_type ?? undefined,
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

  loadCarryover(before: string): Observable<ScheduleEntryDto[]> {
    return this.http
      .get<CarryoverApiResponse>(`${this.apiBase}/schedule/plan/carryover?before=${before}`)
      .pipe(
        tap(resp => this.carryoverItemsSignal.set(resp.carryover)),
        map(resp => resp.carryover),
      );
  }

  checkPlanStatus(start: string, end: string): void {
    this.http
      .get<PlanStatusResponse>(`${this.apiBase}/schedule/plan/status?start=${start}&end=${end}`)
      .subscribe({
        next: resp => this.hasUnplannedHorizonSignal.set(!resp.planned),
        error: noop,
      });
  }

  commitPlan(taskId: string, replace = false): Observable<PostSchedulePlanResponse> {
    this.isSubmittingSignal.set(true);
    return of(null).pipe(
      switchMap(() => {
        const req = this.buildCommitRequest(taskId, replace);
        return this.http.post<PostSchedulePlanResponse>(`${this.apiBase}/schedule/plan`, req);
      }),
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
    if (decision !== 'drop') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      this.dropReasonsSignal.update(({ [entryId]: _, ...rest }) => rest);
    }
  }

  setDropReason(entryId: string, reason: DropReason): void {
    this.dropReasonsSignal.update(d => {
      // Toggle: if already selected, deselect
      if (d[entryId] === reason) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [entryId]: _, ...rest } = d;
        return rest;
      }
      return { ...d, [entryId]: reason };
    });
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

  approveMeal(date: string, slot: MealSlot): void {
    this.scheduledMealsSignal.update(m => {
      const existing = m[date]?.[slot];
      if (!existing) return m;
      return {
        ...m,
        [date]: { ...(m[date] ?? {}), [slot]: { ...existing, approvalState: 'approved' } },
      };
    });
  }

  skipMeal(date: string, slot: MealSlot): void {
    const existing = this.scheduledMealsSignal()[date]?.[slot];
    this.setMeal(date, slot, {
      approvalState: 'skipped',
      mealRef: existing?.mealRef ?? null,
      title: existing?.title ?? '',
    });
  }

  undoSkip(date: string, slot: MealSlot): void {
    this.scheduledMealsSignal.update(m => {
      const existing = m[date]?.[slot];
      if (!existing || existing.approvalState !== 'skipped') return m;
      return {
        ...m,
        [date]: { ...(m[date] ?? {}), [slot]: { ...existing, approvalState: 'proposed' } },
      };
    });
  }

  setMealRef(
    date: string,
    slot: MealSlot,
    ref: MealRef | null,
    title: string,
    nutrition?: MealNutrition,
    estimated?: boolean,
  ): void {
    this.setMeal(date, slot, {
      approvalState: 'approved',
      mealRef: ref,
      title,
      nutrition,
      estimated,
    });
  }

  /** Serialises current scheduledMeals into the shape the agent API expects. */
  currentState(): MealPlanState {
    const meals = this.scheduledMealsSignal();
    const entries = this.horizonDays().flatMap(date =>
      this.mealPatternService.entries().map(patternEntry => {
        const slot = patternEntry.name;
        const meal = meals[date]?.[slot];
        return {
          date,
          occasion: slot,
          meal_ref: meal?.mealRef ?? null,
          title: meal?.title,
          approved: meal?.approvalState === 'approved',
          skipped: meal?.approvalState === 'skipped',
        };
      })
    );
    return { week_start: this.planStartSignal(), meals: entries };
  }

  /** Merges agent-returned meals into scheduledMeals in a single update, preserving approved/skipped cells. */
  applyAgentMeals(agentMeals: MealEntry[]): void {
    this.isGeneratingSignal.set(false);
    this.scheduledMealsSignal.update(current => {
      const next = { ...current };
      for (const entry of agentMeals) {
        const slot     = entry.occasion as MealSlot;
        const existing = current[entry.date]?.[slot];
        if (!existing || existing.approvalState === 'proposed') {
          next[entry.date] = { ...(next[entry.date] ?? {}), [slot]: {
            approvalState: 'proposed',
            mealRef: entry.meal_ref,
            title: entry.title ?? '',
            nutrition: entry.estimated_nutrition,
            estimated: entry.estimated,
          } };
        }
      }
      return next;
    });
  }

  setGenerating(value: boolean): void {
    this.isGeneratingSignal.set(value);
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
    const end   = this.planEndSignal();
    if (!start || !end) return [];
    // Parse as local-noon to avoid UTC-offset day rollback
    const cur     = new Date(`${start}T12:00:00`);
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
    this.dropReasonsSignal.set({});
    this.hasUnplannedHorizonSignal.set(false);
    this.isSubmittingSignal.set(false);
    this.planningTaskIdSignal.set('');
    this.floatingTasksSignal.set([]);
    this.isGeneratingSignal.set(false);
    this.clearDraft();
  }

  private buildCommitRequest(taskId: string, replace: boolean): PostSchedulePlanRequest {
    const meals   = this.scheduledMealsSignal();
    const tasks   = this.scheduledTasksSignal();
    const entries: PlanEntryRequest[] = [];

    for (const date of this.horizonDays()) {
      for (const patternEntry of this.mealPatternService.entries()) {
        const slot = patternEntry.name;
        const meal = meals[date]?.[slot];
        if (meal?.approvalState === 'skipped') continue;
        entries.push({
          date,
          task_ref_id: meal?.mealRef?.id,
          task_ref_type: meal?.mealRef?.type as 'catalog' | 'user' | undefined,
          title: meal?.mealRef ? undefined : (meal?.title ?? `(${slot})`),
          scheduled_start: preferredTimeHHMM(patternEntry.preferred_time),
          after_anchor: slot,
        });
      }
    }

    for (const task of tasks) {
      const type = (task.task_type as string) === 'custom' ? 'general' : (task.task_type ?? 'general');
      entries.push({
        date: task.date,
        task_type: type as TaskType,
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
      carryover_drop_reasons: this.dropReasonsSignal(),
    };
  }
}

/** Extracts "HH:MM" from an ISO timestamp string using UTC hours/minutes. */
function utcHHMM(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}
