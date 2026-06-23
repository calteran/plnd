import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, switchMap, map, catchError, forkJoin } from 'rxjs';
import { ConfigService } from './config.service';
import { MealAnchor, TaskEditPatch, isMealAnchor } from '../models/schedule';
import { ScheduleAnchorDto, ScheduleEntryDto, SchedulePeriodResponse } from '../models/week-plan';
import { PlannedMealEntryDto } from '../models/planned-meal-entry';
import { todayIso } from '../utils/date-only';
import { assembleScheduleItems, assembleSlotGroups } from '../utils/schedule-assembly';

export type RepositionTarget = { afterAnchor: string } | { mealAnchorId: string };

export type MealConsumptionApi = 'planned' | 'consumed' | 'skipped';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http       = inject(HttpClient);
  private readonly apiBase    = inject(ConfigService).getConfig().api.baseUrl;
  private readonly destroyRef = inject(DestroyRef);

  // ── Single source of truth ──────────────────────────────────────────────────
  // The day view is two projections of the *same* raw payload: a flat interleaved
  // item list and a list of droppable slot groups. Rather than store both assembled
  // views and hand-sync every mutation (the bug class tracked in #987), we hold the
  // raw DTOs and derive both views with `computed()`. Every optimistic mutation
  // edits one raw signal; both projections re-derive automatically and stay in lock-step.
  private readonly _anchors      = signal<ScheduleAnchorDto[]>([]);
  private readonly _entries      = signal<ScheduleEntryDto[]>([]);
  private readonly _plannedMeals = signal<PlannedMealEntryDto[]>([]);
  private readonly _loading      = signal(false);
  private readonly _error        = signal<string | null>(null);
  private readonly _date         = signal(todayIso());
  private readonly _loadTrigger$ = new Subject<string>();

  readonly scheduleItems = computed(() =>
    assembleScheduleItems(this._anchors(), this._entries(), this._plannedMeals()));
  readonly slotGroups = computed(() =>
    assembleSlotGroups(this._anchors(), this._entries(), this._plannedMeals()));
  readonly isLoading = this._loading.asReadonly();
  readonly loadError = this._error.asReadonly();
  readonly date      = this._date.asReadonly();

  constructor() {
    this._loadTrigger$.pipe(
      switchMap(date => forkJoin({
        schedule: this.http
          .get<SchedulePeriodResponse>(`${this.apiBase}/schedule/period`, {
            params: { start: date, end: date },
          })
          .pipe(
            map(resp => ({ data: resp, error: false as const })),
            catchError(() => of({
              data: { entries: [], carryover: [], planned_meals: [] } satisfies SchedulePeriodResponse,
              error: true as const,
            })),
          ),
        anchors: this.http
          .get<ScheduleAnchorDto[]>(`${this.apiBase}/schedule/anchors`, { params: { date } })
          .pipe(catchError(() => of([] as ScheduleAnchorDto[]))),
      })),
      takeUntilDestroyed(),
    ).subscribe(({ schedule, anchors }) => {
      if (schedule.error) this._error.set('Failed to load schedule');
      this._anchors.set(anchors);
      this._entries.set(schedule.data.entries);
      this._plannedMeals.set(schedule.data.planned_meals ?? []);
      this._loading.set(false);
    });
  }

  loadDay(date: string): void {
    this._date.set(date);
    this._loading.set(true);
    this._error.set(null);
    this._loadTrigger$.next(date);
  }

  toggleItem(id: string): void {
    const entry = this._entries().find(e => e.entry_id === id);
    if (!entry) return;

    // Floating and during-meal tasks are both plain entries — flipping the raw
    // status re-derives the matching row in either projection. The API status is
    // the inverse UI flip: 'planned' (pending) ⇄ 'completed' (done).
    const nextStatus = entry.status === 'completed' ? 'planned' : 'completed';
    this._entries.update(entries =>
      entries.map(e => (e.entry_id === id ? { ...e, status: nextStatus } : e)));

    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: nextStatus })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /**
   * Apply a partial edit to a task entry (title/type/time/duration/energy/one_shot).
   * Optimistic: edits the raw entry, PATCHes, and reloads the day on error. Meal
   * anchors live in `_anchors`, not `_entries`, so an anchor id no-ops here.
   */
  updateEntry(id: string, patch: TaskEditPatch): void {
    if (!this._entries().some(e => e.entry_id === id)) return;

    this._entries.update(entries =>
      entries.map(e => (e.entry_id === id ? applyPatchToEntry(e, patch) : e)));

    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}`, toPatchBody(patch))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /** Set a meal anchor's consumption status (planned/consumed/skipped). */
  setMealConsumption(id: string, status: MealConsumptionApi): void {
    this._anchors.update(anchors =>
      anchors.map(a => (a.kind === 'meal' && a.id === id ? { ...a, status } : a)));
    this.http
      .patch(`${this.apiBase}/schedule/anchors/${id}/status`, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /** Toggle a meal between consumed and not-consumed (day-view checkbox). */
  toggleMealConsumed(id: string): void {
    const meal = this.scheduleItems().find(i => isMealAnchor(i) && i.id === id) as MealAnchor | undefined;
    if (!meal) return;
    this.setMealConsumption(id, meal.status === 'done' ? 'planned' : 'consumed');
  }

  repositionTask(
    entryId: string,
    date: string,
    target: RepositionTarget,
    position: number,
  ): Observable<void> {
    const body: Record<string, unknown> = { date, position };
    if ('afterAnchor' in target) body['after_anchor'] = target.afterAnchor;
    else body['slot_meal_anchor_id'] = target.mealAnchorId;
    return this.http.patch<void>(`${this.apiBase}/schedule/entries/${entryId}/position`, body);
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Apply a UI edit patch onto a raw entry DTO. Derived views (label, floating,
 *  placement) recompute from the resulting DTO via the assemble functions. */
function applyPatchToEntry(e: ScheduleEntryDto, p: TaskEditPatch): ScheduleEntryDto {
  return {
    ...e,
    title:            p.title           ?? e.title,
    task_type:        p.type            ?? e.task_type,
    scheduled_start:  p.scheduledStart  ?? e.scheduled_start,
    duration_minutes: p.durationMinutes ?? e.duration_minutes,
    energy_required:  p.energy          ?? e.energy_required,
    one_shot:         p.oneShot         ?? e.one_shot,
  };
}

// ── API → request mapping ─────────────────────────────────────────────────────

function toPatchBody(p: TaskEditPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.title !== undefined)           body['title'] = p.title;
  if (p.type !== undefined)            body['task_type'] = p.type;
  if (p.scheduledStart !== undefined)  body['scheduled_start'] = p.scheduledStart;
  if (p.durationMinutes !== undefined) body['duration_minutes'] = p.durationMinutes;
  if (p.energy !== undefined)          body['energy_required'] = p.energy;
  if (p.oneShot !== undefined)         body['one_shot'] = p.oneShot;
  return body;
}
