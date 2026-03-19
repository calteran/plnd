import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import {
  UserDishPref,
  UserDishPrefDetail,
  CreateDishFromCatalogRequest,
  CreateDishFromScratchRequest,
  UpdateDishMetaRequest,
  UpdateDishRecipeRequest,
  DishIngredientRequest,
} from '../models/user-dish-pref';

@Injectable({ providedIn: 'root' })
export class UserDishesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly _dishes = signal<UserDishPref[]>([]);
  readonly dishes = this._dishes.asReadonly();

  private _loaded = false;

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.http.get<UserDishPref[]>(`${this.apiBase}/my/dishes`).subscribe({
      next: dishes => this._dishes.set(dishes),
      error: () => { this._loaded = false; },
    });
  }

  addFromCatalog(catalogDishId: string): Observable<UserDishPref> {
    const req: CreateDishFromCatalogRequest = { catalog_dish_id: catalogDishId };
    return this.http
      .post<UserDishPref>(`${this.apiBase}/my/dishes`, req)
      .pipe(tap(dish => this._dishes.set([...this._dishes(), dish])));
  }

  createFromScratch(req: CreateDishFromScratchRequest): Observable<UserDishPref> {
    return this.http
      .post<UserDishPref>(`${this.apiBase}/my/dishes`, req)
      .pipe(tap(dish => this._dishes.set([...this._dishes(), dish])));
  }

  updateMetadata(prefId: string, req: UpdateDishMetaRequest): Observable<UserDishPref> {
    return this.http
      .patch<UserDishPref>(`${this.apiBase}/my/dishes/${prefId}`, req)
      .pipe(tap(updated => this._replaceInSignal(updated)));
  }

  updateRecipe(prefId: string, req: UpdateDishRecipeRequest): Observable<UserDishPref> {
    return this.http
      .patch<UserDishPref>(`${this.apiBase}/my/dishes/${prefId}`, req)
      .pipe(tap(updated => this._replaceInSignal(updated)));
  }

  remove(prefId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/my/dishes/${prefId}`)
      .pipe(tap(() => this._dishes.set(this._dishes().filter(d => d.user_dish_pref_id !== prefId))));
  }

  getDetail(prefId: string): Observable<UserDishPrefDetail> {
    return this.http.get<UserDishPrefDetail>(`${this.apiBase}/my/dishes/${prefId}`);
  }

  addIngredient(prefId: string, req: DishIngredientRequest): Observable<UserDishPref> {
    return this.http
      .post<UserDishPref>(`${this.apiBase}/my/dishes/${prefId}/ingredients`, req)
      .pipe(tap(updated => this._replaceInSignal(updated)));
  }

  clear(): void {
    this._dishes.set([]);
    this._loaded = false;
  }

  private _replaceInSignal(updated: UserDishPref): void {
    const current = this._dishes();
    const idx = current.findIndex(d => d.user_dish_pref_id === updated.user_dish_pref_id);
    if (idx >= 0) {
      this._dishes.set([...current.slice(0, idx), updated, ...current.slice(idx + 1)]);
    }
  }
}
