import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';
import {
  MealEntry, MealPlanResponse, MealPlanState, MealRef, MealSlot, ResolveResponse,
} from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class MealPlannerAgentService {
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  generateWeek(weekStart: string, currentState: MealPlanState): Observable<MealPlanResponse> {
    return this.http.post<MealPlanResponse>(`${this.apiBase}/agent/meal-plan`, {
      week_start: weekStart,
      current_state: currentState,
    });
  }

  rebalance(weekStart: string, currentState: MealPlanState): Observable<MealPlanResponse> {
    return this.http.post<MealPlanResponse>(`${this.apiBase}/agent/meal-plan/rebalance`, {
      week_start: weekStart,
      current_state: currentState,
    });
  }

  suggestSlot(date: string, mealName: MealSlot, avoid: MealRef[] = []): Observable<MealEntry> {
    return this.http.post<MealEntry>(`${this.apiBase}/agent/meal-plan/suggest`, {
      date,
      meal_name: mealName,
      ...(avoid.length ? { context: { avoid_meal_refs: avoid } } : {}),
    });
  }

  resolveText(text: string, mealName: MealSlot, date?: string): Observable<ResolveResponse> {
    return this.http.post<ResolveResponse>(`${this.apiBase}/agent/meal-plan/resolve`, {
      text,
      meal_name: mealName,
      ...(date ? { date } : {}),
    });
  }
}
