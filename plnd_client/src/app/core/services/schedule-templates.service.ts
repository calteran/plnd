import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { ScheduleTemplate, CreateScheduleTemplateRequest, UpdateScheduleTemplateRequest } from '../models/schedule-template';

@Injectable({ providedIn: 'root' })
export class ScheduleTemplatesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly templatesSignal = signal<ScheduleTemplate[] | null>(null);
  private loaded = false;

  /** The current schedule templates — null until load() succeeds */
  readonly templates = this.templatesSignal.asReadonly();

  /** Fetch templates from the API and cache in the signal. No-ops if already loaded. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.get<ScheduleTemplate[]>(`${apiBase}/schedule/templates`).subscribe({
      next: items => this.templatesSignal.set(items),
      error: err => {
        this.loaded = false;
        console.error('Failed to load schedule templates', err);
      }
    });
  }

  /** POST /schedule/templates and append the new item to the signal */
  create(req: CreateScheduleTemplateRequest): Observable<ScheduleTemplate> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.post<ScheduleTemplate>(`${apiBase}/schedule/templates`, req).pipe(
      tap(item => {
        const current = this.templatesSignal() ?? [];
        this.templatesSignal.set([...current, item]);
      })
    );
  }

  /** DELETE /schedule/templates/{id} and remove the item from the signal */
  delete(id: string): Observable<void> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.delete<void>(`${apiBase}/schedule/templates/${id}`).pipe(
      tap(() => {
        const current = this.templatesSignal() ?? [];
        this.templatesSignal.set(current.filter(t => t.template_id !== id));
      })
    );
  }

  /** PUT /schedule/templates/{id} and update the item in the signal */
  update(id: string, req: UpdateScheduleTemplateRequest): Observable<ScheduleTemplate> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.put<ScheduleTemplate>(`${apiBase}/schedule/templates/${id}`, req).pipe(
      tap(updated => {
        const current = this.templatesSignal();
        if (current) {
          this.templatesSignal.set(current.map(t => (t.template_id === id ? updated : t)));
        }
      })
    );
  }

  /** Reset the templates signal (called on logout) */
  clear(): void {
    this.templatesSignal.set(null);
    this.loaded = false;
  }
}
