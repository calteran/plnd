import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, catchError, of, shareReplay, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { SKIP_AUTH_ERROR } from '../interceptors/auth-context-tokens';
import { MealSuggestion, MealSlot } from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class MealSuggestionsService {
  private readonly http   = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  // Plain Map<key, WritableSignal<MealSuggestion[]>> — not a signal-of-map,
  // because we want each (date, slot) signal to be independently reactive.
  private readonly _cache = new Map<string, ReturnType<typeof signal<MealSuggestion[]>>>();
  private readonly _obs   = new Map<string, Observable<MealSuggestion[]>>();

  /** Returns the cached suggestions for a given (date, slot).
   *  Prefer calling ensureLoaded(date, slot) and reading from its emission for correctness.
   *  Direct reads before ensureLoaded (or load) completes return []. */
  suggestions(date: string, slot: MealSlot): MealSuggestion[] {
    return this._cache.get(`${date}:${slot}`)?.() ?? [];
  }

  /** Ensures suggestions for (date, slot) are loaded and returns an Observable that
   *  resolves with the result. Safe to call multiple times — uses shareReplay(1) so
   *  concurrent or late subscribers share a single HTTP request. */
  ensureLoaded(date: string, slot: MealSlot): Observable<MealSuggestion[]> {
    const key = `${date}:${slot}`;
    const cached = this._obs.get(key);
    if (cached) return cached;

    const sig = signal<MealSuggestion[]>([]);
    this._cache.set(key, sig);

    const obs$ = this.http
      .get<MealSuggestion[]>(`${this.apiBase}/my/meal-suggestions`, {
        params: { date, slot },
        context: new HttpContext().set(SKIP_AUTH_ERROR, true),
      })
      .pipe(
        catchError(() => {
          this._obs.delete(key);
          return of([] as MealSuggestion[]);
        }),
        tap(data => sig.set(data)),
        shareReplay(1),
      );
    this._obs.set(key, obs$);
    return obs$;
  }

  /** Fires a GET /my/meal-suggestions request if no request for this (date, slot) is in-flight
   *  or already cached. Safe to call multiple times. */
  load(date: string, slot: MealSlot): void {
    this.ensureLoaded(date, slot).subscribe();
  }
}
