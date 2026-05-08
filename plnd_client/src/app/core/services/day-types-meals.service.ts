import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { DayTypesService } from './day-types.service';
import { DayTypeResponse } from '../models/day-type';
import { MealPatternEntry } from '../models/meal-pattern';

@Injectable({ providedIn: 'root' })
export class DayTypesMealsService {
  private readonly dayTypesService = inject(DayTypesService);

  private readonly dayTypesSignal = signal<DayTypeResponse[]>([]);
  private readonly loadedSignal = signal(false);
  private requested = false;

  readonly loaded = this.loadedSignal.asReadonly();

  readonly allEntries = computed<MealPatternEntry[]>(() => {
    const seen   = new Set<string>();
    const result: MealPatternEntry[] = [];
    for (const dt of this.dayTypesSignal()) {
      for (const meal of dt.meals ?? []) {
        if (!seen.has(meal.name)) {
          seen.add(meal.name);
          result.push(meal);
        }
      }
    }
    return result.sort((a, b) => a.sort_order - b.sort_order);
  });

  load(): void {
    if (this.requested) return;
    this.requested = true;
    this.dayTypesService.list().pipe(
      switchMap(dayTypes =>
        dayTypes.length === 0
          ? of([] as DayTypeResponse[])
          : forkJoin(dayTypes.map(dt =>
              this.dayTypesService.listMeals(dt.id).pipe(
                map(meals => ({ ...dt, meals }) as DayTypeResponse)
              )
            ))
      ),
    ).subscribe({
      next:  dayTypes => { this.dayTypesSignal.set(dayTypes); this.loadedSignal.set(true); },
      error: ()        => { this.requested = false;            this.loadedSignal.set(true); },
    });
  }

  mealsForDate(date: string): MealPatternEntry[] {
    const dayTypes = this.dayTypesSignal();
    if (dayTypes.length === 0) return [];
    const dow = new Date(`${date}T12:00:00`).getDay(); // 0=Sun…6=Sat
    const bit = 1 << dow;
    const match = dayTypes.find(dt => !dt.is_cycle && !dt.is_default && (dt.days_bitmask & bit) !== 0);
    const dayType = match ?? dayTypes.find(dt => dt.is_default);
    return dayType?.meals ?? [];
  }

  clear(): void {
    this.dayTypesSignal.set([]);
    this.loadedSignal.set(false);
    this.requested = false;
  }
}
