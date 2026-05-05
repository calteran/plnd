import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import {
  MealPatternEntry,
  CreateMealPatternEntryRequest,
  UpdateMealPatternEntryRequest,
} from '../models/meal-pattern';

@Injectable({ providedIn: 'root' })
export class MealPatternService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly entriesSignal = signal<MealPatternEntry[]>([]);
  private loaded = false;

  readonly entries = this.entriesSignal.asReadonly();

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.http.get<MealPatternEntry[]>(`${this.apiBase}/meal-pattern`).subscribe({
      next: entries => this.entriesSignal.set(entries),
      error: () => { this.loaded = false; },
    });
  }

  create(req: CreateMealPatternEntryRequest): Observable<MealPatternEntry> {
    return this.http
      .post<MealPatternEntry>(`${this.apiBase}/meal-pattern`, req)
      .pipe(tap(entry =>
        this.entriesSignal.update(e =>
          [...e, entry].sort((a, b) => a.sort_order - b.sort_order)
        )
      ));
  }

  update(id: string, req: UpdateMealPatternEntryRequest): Observable<MealPatternEntry> {
    return this.http
      .patch<MealPatternEntry>(`${this.apiBase}/meal-pattern/${id}`, req)
      .pipe(tap(updated =>
        this.entriesSignal.update(e =>
          e.map(x => x.id === id ? updated : x)
           .sort((a, b) => a.sort_order - b.sort_order)
        )
      ));
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/meal-pattern/${id}`)
      .pipe(tap(() =>
        this.entriesSignal.update(e => e.filter(x => x.id !== id))
      ));
  }

  clear(): void {
    this.entriesSignal.set([]);
    this.loaded = false;
  }
}
