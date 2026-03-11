import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import {
  DietaryRestriction,
  CreateRestrictionRequest,
  UpdateRestrictionRequest
} from '../models/dietary-restriction';

function sortRestrictions(items: DietaryRestriction[]): DietaryRestriction[] {
  return [...items].sort((a, b) => {
    const typeCmp = a.restriction_type.localeCompare(b.restriction_type);
    return typeCmp !== 0 ? typeCmp : a.name.localeCompare(b.name);
  });
}

@Injectable({ providedIn: 'root' })
export class DietaryRestrictionsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly restrictionsSignal = signal<DietaryRestriction[] | null>(null);

  /** The current dietary restrictions — null until load() succeeds */
  readonly restrictions = this.restrictionsSignal.asReadonly();

  /** Fetch restrictions from the API and cache in the signal. No-ops if already loaded. */
  load(): void {
    if (this.restrictionsSignal() !== null) return;

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.get<DietaryRestriction[]>(`${apiBase}/dietary-restrictions`).subscribe({
      next: items => this.restrictionsSignal.set(sortRestrictions(items)),
      error: err => console.error('Failed to load dietary restrictions', err)
    });
  }

  /** POST /dietary-restrictions and append the new item to the signal (sorted) */
  create(req: CreateRestrictionRequest): Observable<DietaryRestriction> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.post<DietaryRestriction>(`${apiBase}/dietary-restrictions`, req).pipe(
      tap(item => {
        const current = this.restrictionsSignal() ?? [];
        this.restrictionsSignal.set(sortRestrictions([...current, item]));
      })
    );
  }

  /** PATCH /dietary-restrictions/{id} and replace the matching item in the signal */
  update(id: string, req: UpdateRestrictionRequest): Observable<DietaryRestriction> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.patch<DietaryRestriction>(`${apiBase}/dietary-restrictions/${id}`, req).pipe(
      tap(updated => {
        const current = this.restrictionsSignal() ?? [];
        this.restrictionsSignal.set(
          current.map(item => (item.restriction_id === id ? updated : item))
        );
      })
    );
  }

  /** DELETE /dietary-restrictions/{id} and remove the item from the signal */
  delete(id: string): Observable<void> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.delete<void>(`${apiBase}/dietary-restrictions/${id}`).pipe(
      tap(() => {
        const current = this.restrictionsSignal() ?? [];
        this.restrictionsSignal.set(current.filter(item => item.restriction_id !== id));
      })
    );
  }

  /** Reset the restrictions signal (called on logout) */
  clear(): void {
    this.restrictionsSignal.set(null);
  }
}
