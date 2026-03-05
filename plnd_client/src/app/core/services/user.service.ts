import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { User, UpdateProfileRequest } from '../models/user';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly userSignal = signal<User | null>(null);

  /** The current user profile — null until loadUser() succeeds */
  readonly user = this.userSignal.asReadonly();

  /** Fetch the current user from the API and cache in the signal. No-ops if already loaded. */
  loadUser(): void {
    if (this.userSignal()) return;

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.get<User>(`${apiBase}/users/me`).subscribe({
      next: user => this.userSignal.set(user),
      error: err => console.error('Failed to load user profile', err)
    });
  }

  /** PATCH /users/me and update the signal on success */
  updateUser(req: UpdateProfileRequest): Observable<User> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.patch<User>(`${apiBase}/users/me`, req).pipe(
      tap(user => this.userSignal.set(user))
    );
  }

  /** Reset the user signal (called on logout) */
  clearUser(): void {
    this.userSignal.set(null);
  }
}
