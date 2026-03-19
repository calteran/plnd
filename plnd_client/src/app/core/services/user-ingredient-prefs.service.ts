import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { UserIngredientPref, IngredientPrefRequest } from '../models/user-ingredient-pref';

@Injectable({ providedIn: 'root' })
export class UserIngredientPrefsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly _prefs = signal<UserIngredientPref[]>([]);
  readonly prefs = this._prefs.asReadonly();

  private _loaded = false;

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.http.get<UserIngredientPref[]>(`${this.apiBase}/my/ingredient-prefs`).subscribe({
      next: prefs => this._prefs.set(prefs),
      error: () => { this._loaded = false; },
    });
  }

  upsert(catalogIngredientId: string, req: IngredientPrefRequest): Observable<UserIngredientPref> {
    return this.http
      .put<UserIngredientPref>(`${this.apiBase}/my/ingredient-prefs/${catalogIngredientId}`, req)
      .pipe(
        tap(updated => {
          const current = this._prefs();
          const idx = current.findIndex(p => p.catalog_ingredient_id === catalogIngredientId);
          if (idx >= 0) {
            this._prefs.set([...current.slice(0, idx), updated, ...current.slice(idx + 1)]);
          } else {
            this._prefs.set([...current, updated]);
          }
        })
      );
  }

  remove(catalogIngredientId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/my/ingredient-prefs/${catalogIngredientId}`)
      .pipe(
        tap(() => {
          this._prefs.set(this._prefs().filter(p => p.catalog_ingredient_id !== catalogIngredientId));
        })
      );
  }

  clear(): void {
    this._prefs.set([]);
    this._loaded = false;
  }
}
