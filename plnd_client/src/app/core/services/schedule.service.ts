import { Injectable, signal } from '@angular/core';
import { ScheduleItem, ItemStatus, isMealAnchor } from '../models/schedule';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
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

    // TODO: replace with HttpClient GET /schedule?date=<date>
    setTimeout(() => {
      this._items.set(mockItems(date));
      this._loading.set(false);
    }, 300);
  }

  toggleItem(id: string): void {
    this._items.update(items => items.map(item => {
      if (isMealAnchor(item)) {
        return {
          ...item,
          duringMealTasks: item.duringMealTasks.map(t =>
            t.id === id ? { ...t, status: flip(t.status) } : t
          )
        };
      }
      return item.id === id ? { ...item, status: flip(item.status) } : item;
    }));
  }
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function flip(status: ItemStatus): ItemStatus {
  return status === 'done' ? 'pending' : 'done';
}

function mockItems(date: string): ScheduleItem[] {
  const isToday = date === todayIso();
  const done = (s: ItemStatus) => isToday ? 'done' : s;

  return [
    { id: 't1', type: 'task', label: '🧘 5-min stretch', status: done('pending') },
    {
      id: 'm1', name: 'Breakfast', emoji: '🥑',
      description: 'Avocado toast + eggs',
      status: isToday ? 'done' : 'planned',
      duringMealTasks: [
        { id: 't-dm1', type: 'task', label: '💊 Morning vitamins', status: done('pending') },
        { id: 't-dm2', type: 'task', label: '📖 Read 10 pages',    status: 'pending' }
      ]
    },
    { id: 't2', type: 'exercise',    label: '🏃 Morning run · 30 min',    status: done('pending') },
    { id: 't3', type: 'task',        label: '✉️ Reply to dentist email',   status: 'pending' },
    { id: 't4', type: 'appointment', label: '📅 Team standup',             status: 'pending', scheduledTime: '11 AM' },
    { id: 't5', type: 'task',        label: '📞 Call pharmacy',            status: 'pending' },
    { id: 'm2', name: 'Lunch',  emoji: '🥗', status: 'unplanned', duringMealTasks: [] },
    { id: 't6', type: 'appointment', label: '🏥 GP appointment',           status: 'pending', scheduledTime: '2 PM' },
    { id: 't7', type: 'task',        label: '🛒 Pick up prescription',     status: 'pending' },
    { id: 'm3', name: 'Dinner', emoji: '🍽', status: 'unplanned', duringMealTasks: [] }
  ];
}
