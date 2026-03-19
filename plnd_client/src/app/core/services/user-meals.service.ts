import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import {
  UserMealPref,
  UserMealPrefDetail,
  CreateMealFromCatalogRequest,
  CreateMealFromScratchRequest,
  UpdateMealMetaRequest,
  UpdateMealRecipeRequest,
  MealDishRequest,
} from '../models/user-meal-pref';

@Injectable({ providedIn: 'root' })
export class UserMealsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly _meals = signal<UserMealPref[]>([]);
  readonly meals = this._meals.asReadonly();

  private _loaded = false;

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.http.get<UserMealPref[]>(`${this.apiBase}/my/meals`).subscribe({
      next: meals => this._meals.set(meals),
      error: () => { this._loaded = false; },
    });
  }

  addFromCatalog(catalogMealId: string): Observable<UserMealPref> {
    const req: CreateMealFromCatalogRequest = { catalog_meal_id: catalogMealId };
    return this.http
      .post<UserMealPref>(`${this.apiBase}/my/meals`, req)
      .pipe(tap(meal => this._meals.set([...this._meals(), meal])));
  }

  createFromScratch(req: CreateMealFromScratchRequest): Observable<UserMealPref> {
    return this.http
      .post<UserMealPref>(`${this.apiBase}/my/meals`, req)
      .pipe(tap(meal => this._meals.set([...this._meals(), meal])));
  }

  updateMetadata(prefId: string, req: UpdateMealMetaRequest): Observable<UserMealPref> {
    return this.http
      .patch<UserMealPref>(`${this.apiBase}/my/meals/${prefId}`, req)
      .pipe(tap(updated => this._replaceInSignal(updated)));
  }

  updateRecipe(prefId: string, req: UpdateMealRecipeRequest): Observable<UserMealPref> {
    return this.http
      .patch<UserMealPref>(`${this.apiBase}/my/meals/${prefId}`, req)
      .pipe(tap(updated => this._replaceInSignal(updated)));
  }

  remove(prefId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/my/meals/${prefId}`)
      .pipe(tap(() => this._meals.set(this._meals().filter(m => m.user_meal_pref_id !== prefId))));
  }

  getDetail(prefId: string): Observable<UserMealPrefDetail> {
    return this.http.get<UserMealPrefDetail>(`${this.apiBase}/my/meals/${prefId}`);
  }

  addDish(prefId: string, req: MealDishRequest): Observable<UserMealPref> {
    return this.http
      .post<UserMealPref>(`${this.apiBase}/my/meals/${prefId}/dishes`, req)
      .pipe(tap(updated => this._replaceInSignal(updated)));
  }

  clear(): void {
    this._meals.set([]);
    this._loaded = false;
  }

  private _replaceInSignal(updated: UserMealPref): void {
    const current = this._meals();
    const idx = current.findIndex(m => m.user_meal_pref_id === updated.user_meal_pref_id);
    if (idx >= 0) {
      this._meals.set([...current.slice(0, idx), updated, ...current.slice(idx + 1)]);
    }
  }
}
