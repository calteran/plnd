import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { ConfigService } from './config.service';
import {
  CarryoverDecision, MealSlot, PlanDraftShape,
  PlanEntryRequest, PlannedMeal, PlannedTask,
  PostSchedulePlanRequest, PostSchedulePlanResponse,
  PlanStatusResponse, SchedulePeriodResponse,
} from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class WeekPlanService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

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

  readonly planStart = this.planStartSignal.asReadonly();
  readonly planEnd = this.planEndSignal.asReadonly();
  readonly currentStep = this.currentStepSignal.asReadonly();
  readonly carryoverItems = this.carryoverItemsSignal.asReadonly();
  readonly scheduledTasks = this.scheduledTasksSignal.asReadonly();
  readonly scheduledMeals = this.scheduledMealsSignal.asReadonly();
  readonly carryoverDecisions = this.carryoverDecisionsSignal.asReadonly();
  readonly hasUnplannedHorizon = this.hasUnplannedHorizonSignal.asReadonly();
  readonly isSubmitting = this.isSubmittingSignal.asReadonly();

  initSession(start: string, end: string): void {
    this.planStartSignal.set(start);
    this.planEndSignal.set(end);
    const draft = this.loadDraft();
    if (draft && draft.planStart === start) {
      this.currentStepSignal.set(draft.currentStep);
      this.carryoverDecisionsSignal.set(draft.carryoverDecisions);
      this.scheduledMealsSignal.set(draft.scheduledMeals);
      this.scheduledTasksSignal.set(draft.scheduledTasks);
    } else {
      this.currentStepSignal.set(1);
      this.carryoverDecisionsSignal.set({});
      this.scheduledMealsSignal.set({});
      this.scheduledTasksSignal.set([]);
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
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http
      .get<SchedulePeriodResponse>(`${apiBase}/schedule/period?start=${start}&end=${end}`)
      .pipe(tap(resp => this.carryoverItemsSignal.set(resp.carryover)));
  }

  checkPlanStatus(start: string, end: string): void {
    const apiBase = this.config.getConfig().api.baseUrl;
    this.http
      .get<PlanStatusResponse>(`${apiBase}/schedule/plan/status?start=${start}&end=${end}`)
      .subscribe({
        next: resp => this.hasUnplannedHorizonSignal.set(!resp.planned),
        error: () => {},
      });
  }

  commitPlan(taskId: string, replace = false): Observable<PostSchedulePlanResponse> {
    this.isSubmittingSignal.set(true);
    const apiBase = this.config.getConfig().api.baseUrl;
    const req = this.buildCommitRequest(taskId, replace);
    return this.http.post<PostSchedulePlanResponse>(`${apiBase}/schedule/plan`, req).pipe(
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

  /** Days in the horizon as ISO date strings (inclusive). */
  horizonDays(): string[] {
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
  }

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
  }

  private buildCommitRequest(taskId: string, replace: boolean): PostSchedulePlanRequest {
    const meals = this.scheduledMealsSignal();
    const tasks = this.scheduledTasksSignal();
    const entries: PlanEntryRequest[] = [];

    for (const [date, slots] of Object.entries(meals)) {
      for (const [slot, meal] of Object.entries(slots ?? {})) {
        if (!meal) continue;
        entries.push({
          date,
          task_type: 'meal',
          task_ref_id: meal.type === 'user_meal' ? meal.id : undefined,
          task_ref_type: meal.type === 'user_meal' ? 'user_meal' : undefined,
          title: meal.type === 'mock' ? meal.title : undefined,
          scheduled_start: slotDefaultTime(slot as MealSlot),
          after_milepost: slot as MealSlot,
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

function slotDefaultTime(slot: MealSlot): string {
  const map: Record<MealSlot, string> = {
    breakfast: '08:00',
    lunch: '12:00',
    dinner: '18:00',
    snack: '15:00',
  };
  return map[slot];
}
