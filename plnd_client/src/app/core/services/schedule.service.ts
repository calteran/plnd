import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { ConfigService } from './config.service';
import { ScheduleItem, ItemType, MealAnchor, ScheduleTask, isMealAnchor } from '../models/schedule';
import { ScheduleEntryDto, SchedulePeriodResponse } from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  private readonly _items   = signal<ScheduleItem[]>([]);
  private readonly _loading = signal(false);
  private readonly _error   = signal<string | null>(null);
  private readonly _date    = signal(todayIso());

  readonly scheduleItems = this._items.asReadonly();
  readonly isLoading     = this._loading.asReadonly();
  readonly loadError     = this._error.asReadonly();
  readonly date          = this._date.asReadonly();

  loadDay(date: string): void {
    this._date.set(date);
    this._loading.set(true);
    this._error.set(null);

    this.http
      .get<SchedulePeriodResponse>(`${this.apiBase}/schedule/period`, {
        params: { start: date, end: date },
      })
      .pipe(catchError(() => of({ entries: [], carryover: [] } satisfies SchedulePeriodResponse)))
      .subscribe(resp => {
        if (this._date() !== date) return; // stale response guard
        this._items.set(resp.entries.map(mapEntry));
        this._loading.set(false);
      });
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
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function localIsoDate(d: Date): string {
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
  if (e.task_type === 'meal') {
    const slot = e.after_milepost ? MEAL_SLOTS[e.after_milepost] : undefined;
    return {
      id:    e.entry_id,
      name:  slot?.name ?? e.title ?? 'Meal',
      emoji: slot?.emoji ?? '🍴',
      description: e.title ?? undefined,
      status: e.status === 'completed' ? 'done'
            : e.status === 'planned'   ? 'planned'
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
