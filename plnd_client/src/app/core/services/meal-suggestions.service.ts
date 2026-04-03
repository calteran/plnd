import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from './config.service';
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
  private readonly _pending = new Set<string>();

  /** Returns the cached suggestions for a given (date, slot).
   *  Callers MUST call load(date, slot) before reading; reading before load returns []. */
  suggestions(date: string, slot: MealSlot): MealSuggestion[] {
    return this._cache.get(`${date}:${slot}`)?.() ?? [];
  }

  /** Fires a GET /my/meal-suggestions request if no request for this (date, slot) is in-flight
   *  or already cached. Safe to call multiple times. */
  load(date: string, slot: MealSlot): void {
    const key = `${date}:${slot}`;
    if (this._cache.has(key) || this._pending.has(key)) return;

    const sig = signal<MealSuggestion[]>([]);
    this._cache.set(key, sig);
    this._pending.add(key);

    this.http
      .get<MealSuggestion[]>(`${this.apiBase}/my/meal-suggestions`, { params: { date, slot } })
      .subscribe({
        next:  data  => { sig.set(data);  this._pending.delete(key); },
        error: ()    => { sig.set([]);    this._pending.delete(key); },
      });
  }
}
