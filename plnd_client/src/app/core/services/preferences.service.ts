import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { UserPreferences, UpdatePreferencesRequest } from '../models/preferences';

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly preferencesSignal = signal<UserPreferences | null>(null);

  /** The current user preferences — null until loadPreferences() succeeds */
  readonly preferences = this.preferencesSignal.asReadonly();

  /** Fetch preferences from the API and cache in the signal. No-ops if already loaded. */
  loadPreferences(): void {
    if (this.preferencesSignal()) return;

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.get<UserPreferences>(`${apiBase}/preferences/me`).subscribe({
      next: prefs => this.preferencesSignal.set(prefs),
      error: err => console.error('Failed to load preferences', err)
    });
  }

  /** PATCH /preferences/me and update the signal on success */
  updatePreferences(req: UpdatePreferencesRequest): Observable<UserPreferences> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.patch<UserPreferences>(`${apiBase}/preferences/me`, req).pipe(
      tap(prefs => this.preferencesSignal.set(prefs))
    );
  }

  /** Reset the preferences signal (called on logout) */
  clearPreferences(): void {
    this.preferencesSignal.set(null);
  }
}
