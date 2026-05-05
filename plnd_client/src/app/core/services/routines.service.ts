import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { Routine, CreateRoutineRequest, UpdateRoutineRequest } from '../models/routine';

@Injectable({ providedIn: 'root' })
export class RoutinesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly routinesSignal = signal<Routine[] | null>(null);
  private loaded = false;

  /** The current routines — null until load() succeeds */
  readonly routines = this.routinesSignal.asReadonly();

  /** Fetch routines from the API and cache in the signal. No-ops if already loaded. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.get<Routine[]>(`${apiBase}/routines`).subscribe({
      next: items => this.routinesSignal.set(items),
      error: err => {
        this.loaded = false;
        console.error('Failed to load routines', err);
      }
    });
  }

  /** POST /routines and append the new item to the signal */
  create(req: CreateRoutineRequest): Observable<Routine> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.post<Routine>(`${apiBase}/routines`, req).pipe(
      tap(item => {
        const current = this.routinesSignal() ?? [];
        this.routinesSignal.set([...current, item]);
      })
    );
  }

  /** DELETE /routines/{id} and remove the item from the signal */
  delete(id: string): Observable<void> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.delete<void>(`${apiBase}/routines/${id}`).pipe(
      tap(() => {
        const current = this.routinesSignal() ?? [];
        this.routinesSignal.set(current.filter(t => t.routine_id !== id));
      })
    );
  }

  /** PUT /routines/{id} and update the item in the signal */
  update(id: string, req: UpdateRoutineRequest): Observable<Routine> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.put<Routine>(`${apiBase}/routines/${id}`, req).pipe(
      tap(updated => {
        const current = this.routinesSignal();
        if (current) {
          this.routinesSignal.set(current.map(t => (t.routine_id === id ? updated : t)));
        }
      })
    );
  }

  /** Reset the routines signal (called on logout) */
  clear(): void {
    this.routinesSignal.set(null);
    this.loaded = false;
  }
}
