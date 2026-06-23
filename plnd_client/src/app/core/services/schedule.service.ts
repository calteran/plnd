import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, switchMap, map, catchError, forkJoin } from 'rxjs';
import { ConfigService } from './config.service';
import { ScheduleItem, MealAnchor, ScheduleTask, SlotGroup, TaskEditPatch, isMealAnchor } from '../models/schedule';
import { ScheduleAnchorDto, SchedulePeriodResponse } from '../models/week-plan';
import { todayIso } from '../utils/date-only';
import { assembleScheduleItems, assembleSlotGroups, toMealUiStatus } from '../utils/schedule-assembly';

export type RepositionTarget = { afterAnchor: string } | { mealAnchorId: string };

export type MealConsumptionApi = 'planned' | 'consumed' | 'skipped';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http       = inject(HttpClient);
  private readonly apiBase    = inject(ConfigService).getConfig().api.baseUrl;
  private readonly destroyRef = inject(DestroyRef);

  private readonly _items        = signal<ScheduleItem[]>([]);
  private readonly _slotGroups   = signal<SlotGroup[]>([]);
  private readonly _loading      = signal(false);
  private readonly _error        = signal<string | null>(null);
  private readonly _date         = signal(todayIso());
  private readonly _loadTrigger$ = new Subject<string>();

  readonly scheduleItems = this._items.asReadonly();
  readonly slotGroups    = this._slotGroups.asReadonly();
  readonly isLoading     = this._loading.asReadonly();
  readonly loadError     = this._error.asReadonly();
  readonly date          = this._date.asReadonly();

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
      const entries      = schedule.data.entries;
      const plannedMeals = schedule.data.planned_meals ?? [];
      this._items.set(assembleScheduleItems(anchors, entries, plannedMeals));
      this._slotGroups.set(assembleSlotGroups(anchors, entries, plannedMeals));
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
    const currentStatus = findItemStatus(this._items(), id);
    if (currentStatus === null) return;

    this._items.update(items =>
      items.map(item => {
        if (isMealAnchor(item)) {
          if (!item.duringMealTasks.some(t => t.id === id)) return item;
          return {
            ...item,
            duringMealTasks: item.duringMealTasks.map(t =>
              t.id === id ? { ...t, status: flip(t.status) } : t,
            ),
          };
        }
        return item.id === id ? { ...item, status: flip(item.status) } : item;
      }),
    );

    // Also update _slotGroups so OnPush rows re-render with the new status.
    this._slotGroups.update(groups => updateTaskInGroups(groups, id, task => ({
      ...task, status: flip(task.status),
    })));

    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: toApiStatus(currentStatus) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /**
   * Apply a partial edit to a task entry (title/type/time/duration/energy/one_shot).
   * Optimistic: updates the in-memory item, PATCHes, and reloads the day on error.
   */
  updateEntry(id: string, patch: TaskEditPatch): void {
    if (findItemStatus(this._items(), id) === null) return;

    const apply = (t: ScheduleTask): ScheduleTask => ({
      ...t,
      label:           patch.title ?? t.label,
      type:            patch.type ?? t.type,
      scheduledStart:  patch.scheduledStart ?? t.scheduledStart,
      durationMinutes: patch.durationMinutes ?? t.durationMinutes,
      energy:          patch.energy ?? t.energy,
      oneShot:         patch.oneShot ?? t.oneShot,
    });

    this._items.update(items =>
      items.map(item => {
        if (isMealAnchor(item)) {
          if (!item.duringMealTasks.some(t => t.id === id)) return item;
          return { ...item, duringMealTasks: item.duringMealTasks.map(t => t.id === id ? apply(t) : t) };
        }
        return item.id === id ? apply(item) : item;
      }),
    );

    // Also update _slotGroups so OnPush rows re-render with the edited values.
    this._slotGroups.update(groups => updateTaskInGroups(groups, id, apply));

    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}`, toPatchBody(patch))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /** Set a meal anchor's consumption status (planned/consumed/skipped). */
  setMealConsumption(id: string, status: MealConsumptionApi): void {
    const nextStatus = (desc?: string) => toMealUiStatus(status, desc);
    this._items.update(items =>
      items.map(item =>
        isMealAnchor(item) && item.id === id
          ? { ...item, status: nextStatus(item.description) }
          : item,
      ),
    );
    // Also update _slotGroups so the meal-row re-renders with the new status.
    this._slotGroups.update(groups =>
      groups.map(g => {
        if (g.anchor !== null && isMealAnchor(g.anchor) && g.anchor.id === id) {
          return {
            ...g,
            anchor: { ...g.anchor, status: nextStatus(g.anchor.description) },
          };
        }
        return g;
      }),
    );
    this.http
      .patch(`${this.apiBase}/schedule/anchors/${id}/status`, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /** Toggle a meal between consumed and not-consumed (day-view checkbox). */
  toggleMealConsumed(id: string): void {
    const item = this._items().find(i => isMealAnchor(i) && i.id === id) as MealAnchor | undefined;
    if (!item) return;
    this.setMealConsumption(id, item.status === 'done' ? 'planned' : 'consumed');
  }

  addItem(task: ScheduleTask): void {
    this._items.update(items => [...items, task]);
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

/**
 * Returns a new SlotGroup[] with a single task (identified by `id`) mapped
 * through `fn`. Handles the task appearing as:
 *   - an anchor ScheduleTask (group.anchor)
 *   - a floating task in group.tasks
 *   - a during-meal task in a MealAnchor's duringMealTasks
 * Used to propagate optimistic updates (toggle, edit) to _slotGroups so
 * OnPush task-row components re-render without a full reload.
 */
function updateTaskInGroups(
  groups: SlotGroup[],
  id: string,
  fn: (t: ScheduleTask) => ScheduleTask,
): SlotGroup[] {
  return groups.map(g => {
    // Check if the anchor is the target task
    if (g.anchor !== null && !isMealAnchor(g.anchor) && g.anchor.id === id) {
      return { ...g, anchor: fn(g.anchor) };
    }
    // Check if the anchor is a meal and the target is one of its during-meal tasks
    if (g.anchor !== null && isMealAnchor(g.anchor)) {
      const meal = g.anchor;
      if (meal.duringMealTasks.some(t => t.id === id)) {
        return {
          ...g,
          anchor: {
            ...meal,
            duringMealTasks: meal.duringMealTasks.map(t => t.id === id ? fn(t) : t),
          },
        };
      }
    }
    // Check the floating tasks list
    if (g.tasks.some(t => t.id === id)) {
      return { ...g, tasks: g.tasks.map(t => t.id === id ? fn(t) : t) };
    }
    return g;
  });
}

function flip(status: 'pending' | 'done'): 'pending' | 'done' {
  return status === 'done' ? 'pending' : 'done';
}

function toApiStatus(status: 'pending' | 'done'): 'completed' | 'planned' {
  return status === 'pending' ? 'completed' : 'planned';
}

function findItemStatus(items: ScheduleItem[], id: string): 'pending' | 'done' | null {
  for (const item of items) {
    if (isMealAnchor(item)) {
      const task = item.duringMealTasks.find(t => t.id === id);
      if (task) return task.status;
    } else if (item.id === id) {
      return item.status;
    }
  }
  return null;
}

// ── API → model mapping ───────────────────────────────────────────────────────

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
