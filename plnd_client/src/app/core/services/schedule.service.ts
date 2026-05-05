import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Subject, of, switchMap, map, catchError } from 'rxjs';
import { ConfigService } from './config.service';
import { ScheduleItem, ItemType, MealAnchor, ScheduleTask, isMealAnchor } from '../models/schedule';
import { ScheduleEntryDto, SchedulePeriodResponse } from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

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
      switchMap(date =>
        this.http
          .get<SchedulePeriodResponse>(`${this.apiBase}/schedule/period`, {
            params: { start: date, end: date },
          })
          .pipe(
            map(resp => ({ resp, error: false as const })),
            catchError(() =>
              of({
                resp: { entries: [], carryover: [] } satisfies SchedulePeriodResponse,
                error: true as const,
              }),
            ),
          ),
      ),
      takeUntilDestroyed(),
    ).subscribe(({ resp, error }) => {
      if (error) this._error.set('Failed to load schedule');
      this._items.set(resp.entries.map(mapEntry));
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
  }

  skipMeal(id: string): void {
    this._items.update(items =>
      items.map(item =>
        isMealAnchor(item) && item.id === id ? { ...item, status: 'skipped' as const } : item,
      ),
    );
    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: 'skipped' })
      .subscribe({ error: () => this.loadDay(this._date()) });
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

// ── API → model mapping ───────────────────────────────────────────────────────

const MEAL_SLOTS: Record<string, { name: string; emoji: string }> = {
  breakfast: { name: 'Breakfast', emoji: '🥣' },
  lunch:     { name: 'Lunch',     emoji: '🥗' },
  dinner:    { name: 'Dinner',    emoji: '🍽' },
};

function mapEntry(e: ScheduleEntryDto): ScheduleItem {
  // Meal anchor entries have task_type === null
  if (e.task_type == null) {
    const slot = e.after_anchor ? MEAL_SLOTS[e.after_anchor] : undefined;
    return {
      id:    e.entry_id,
      name:  slot?.name ?? e.title ?? 'Meal',
      emoji: slot?.emoji ?? '🍴',
      description: e.title ?? undefined,
      status: e.status === 'completed' ? 'done'
            : e.status === 'planned'   ? 'planned'
            : e.status === 'skipped'   ? 'skipped'
            : 'unplanned',
      duringMealTasks: [],
    } satisfies MealAnchor;
  }

  const TYPE_MAP: Record<string, ItemType> = {
    exercise:    'exercise',
    appointment: 'appointment',
  };
  return {
    id:     e.entry_id,
    type:   TYPE_MAP[e.task_type] ?? 'task',
    label:  e.title ?? e.task_type,
    status: e.status === 'completed' ? 'done' : 'pending',
  } satisfies ScheduleTask;
}
