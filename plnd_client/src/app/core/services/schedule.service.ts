import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Subject, of, switchMap, map, catchError, forkJoin } from 'rxjs';
import { ConfigService } from './config.service';
import { ScheduleItem, MealAnchor, ScheduleTask, TaskEditPatch, isMealAnchor, parseItemType } from '../models/schedule';
import { MealAnchorInstanceDto, ScheduleEntryDto, SchedulePeriodResponse } from '../models/week-plan';
import { PlannedMealEntryDto } from '../models/planned-meal-entry';

export type MealConsumptionApi = 'planned' | 'consumed' | 'skipped';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http       = inject(HttpClient);
  private readonly apiBase    = inject(ConfigService).getConfig().api.baseUrl;
  private readonly destroyRef = inject(DestroyRef);

  private readonly _items        = signal<ScheduleItem[]>([]);
  private readonly _loading      = signal(false);
  private readonly _error        = signal<string | null>(null);
  private readonly _date         = signal(todayIso());
  private readonly _loadTrigger$ = new Subject<string>();

  readonly scheduleItems = this._items.asReadonly();
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
          .get<MealAnchorInstanceDto[]>(`${this.apiBase}/schedule/anchors`, { params: { date } })
          .pipe(catchError(() => of([] as MealAnchorInstanceDto[]))),
      })),
      takeUntilDestroyed(),
    ).subscribe(({ schedule, anchors }) => {
      if (schedule.error) this._error.set('Failed to load schedule');
      // Index persisted meals by the anchor instance they were committed against,
      // so each anchor row can render the dish a user planned (onboarding / wizard).
      const mealByAnchor = new Map<string, PlannedMealEntryDto>(
        (schedule.data.planned_meals ?? []).map(pm => [pm.meal_anchor_instance_id, pm]),
      );
      this._items.set([
        ...anchors.map(a => mapAnchorInstance(a, mealByAnchor.get(a.id))),
        ...schedule.data.entries.map(mapEntry),
      ]);
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

    this._items.update(items =>
      items.map(item => {
        const apply = (t: ScheduleTask): ScheduleTask => ({
          ...t,
          label:           patch.title ?? t.label,
          type:            patch.type ?? t.type,
          scheduledStart:  patch.scheduledStart ?? t.scheduledStart,
          durationMinutes: patch.durationMinutes ?? t.durationMinutes,
          energy:          patch.energy ?? t.energy,
          oneShot:         patch.oneShot ?? t.oneShot,
        });
        if (isMealAnchor(item)) {
          if (!item.duringMealTasks.some(t => t.id === id)) return item;
          return { ...item, duringMealTasks: item.duringMealTasks.map(t => t.id === id ? apply(t) : t) };
        }
        return item.id === id ? apply(item) : item;
      }),
    );

    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}`, toPatchBody(patch))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /** Set a meal anchor's consumption status (planned/consumed/skipped). */
  setMealConsumption(id: string, status: MealConsumptionApi): void {
    this._items.update(items =>
      items.map(item =>
        isMealAnchor(item) && item.id === id
          ? { ...item, status: toMealUiStatus(status, item.description) }
          : item,
      ),
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
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function localIsoDate(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function todayIso(): string {
  return localIsoDate(new Date());
}

export function offsetIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
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

const MEAL_SLOTS: Record<string, { name: string; emoji: string }> = {
  breakfast: { name: 'Breakfast', emoji: '🥣' },
  lunch:     { name: 'Lunch',     emoji: '🥗' },
  dinner:    { name: 'Dinner',    emoji: '🍽' },
};

/**
 * Folds the backend consumption status into the UI `MealAnchor.status`.
 * `consumed` → done, `skipped` → skipped, `planned` falls back to the
 * dish-planning state (a dish title means 'planned', otherwise 'unplanned').
 */
function toMealUiStatus(
  status: string | undefined,
  description?: string,
): MealAnchor['status'] {
  if (status === 'consumed') return 'done';
  if (status === 'skipped') return 'skipped';
  return description ? 'planned' : 'unplanned';
}

function mapAnchorInstance(dto: MealAnchorInstanceDto, planned?: PlannedMealEntryDto): MealAnchor {
  const slot = MEAL_SLOTS[dto.name.toLowerCase()];
  return {
    id:    dto.id,
    name:  slot?.name ?? dto.name,
    emoji: slot?.emoji ?? '🍴',
    status:      toMealUiStatus(dto.status, planned?.title ?? undefined),
    description: planned?.title ?? undefined,
    duringMealTasks: [],
  };
}

function mapEntry(e: ScheduleEntryDto): ScheduleTask {
  const floating = !e.scheduled_start;
  return {
    id:      e.entry_id,
    type:    parseItemType(e.task_type),
    label:   e.title ?? e.task_type,
    status:  e.status === 'completed' ? 'done' : 'pending',
    scheduledStart: e.scheduled_start ? hhmmUtc(e.scheduled_start) : undefined,
    durationMinutes: e.duration_minutes ?? undefined,
    energy:  (e.energy_required as ScheduleTask['energy']) ?? undefined,
    oneShot: e.one_shot ?? false,
    floating,
  };
}

/** Extract a UTC "HH:MM" from an ISO timestamp (matches the API's wall-clock convention). */
function hhmmUtc(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

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
