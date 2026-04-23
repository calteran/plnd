import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { MealHabitResponse, CreateMealHabitRequest } from '../models/meal-habit';

@Injectable({ providedIn: 'root' })
export class MealHabitsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly habitsSignal = signal<MealHabitResponse[]>([]);
  private loaded = false;

  readonly habits = this.habitsSignal.asReadonly();

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.http.get<MealHabitResponse[]>(`${this.apiBase}/meal-habits`).subscribe({
      next: habits => this.habitsSignal.set(habits),
      error: () => { this.loaded = false; },
    });
  }

  create(req: CreateMealHabitRequest): Observable<MealHabitResponse> {
    return this.http
      .post<MealHabitResponse>(`${this.apiBase}/meal-habits`, req)
      .pipe(tap(habit => this.habitsSignal.update(h => [...h, habit])));
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/meal-habits/${id}`)
      .pipe(tap(() => this.habitsSignal.update(h => h.filter(x => x.id !== id))));
  }

  clear(): void {
    this.habitsSignal.set([]);
    this.loaded = false;
  }
}
