import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { UserService } from '../../../core/services/user.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="profile-page">
      <div class="profile-header">
        <button class="back-btn" (click)="goBack()">← Back</button>
        <h1>My Profile</h1>
      </div>

      @if (!userService.user()) {
        <p class="loading-text">Loading profile…</p>
      } @else {
        <div class="profile-content">
          <!-- Read-only info -->
          <section class="info-section">
            <div class="info-row">
              <span class="info-label">Email</span>
              <span class="info-value">{{ userService.user()!.email }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Member since</span>
              <span class="info-value">{{ formatDate(userService.user()!.created_at) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Last login</span>
              <span class="info-value">
                {{ userService.user()!.last_login ? formatDate(userService.user()!.last_login!) : 'Never' }}
              </span>
            </div>
          </section>

          <!-- Editable form -->
          <form class="edit-form" [formGroup]="form" (ngSubmit)="save()">
            <div class="form-field">
              <label for="display-name">Display name</label>
              <input
                id="display-name"
                type="text"
                formControlName="display_name"
                placeholder="Your name"
                maxlength="100"
              />
              @if (form.controls.display_name.invalid && form.controls.display_name.touched) {
                <span class="field-error">Display name must be 100 characters or fewer</span>
              }
            </div>

            <div class="form-field">
              <label for="avatar-url">Avatar URL</label>
              <input
                id="avatar-url"
                type="url"
                formControlName="avatar_url"
                placeholder="https://example.com/avatar.jpg"
                maxlength="500"
              />
              @if (form.controls.avatar_url.invalid && form.controls.avatar_url.touched) {
                <span class="field-error">Must be a valid URL (https://…) and 500 characters or fewer</span>
              }
            </div>

            @if (successMessage) {
              <p class="status-success">{{ successMessage }}</p>
            }
            @if (errorMessage) {
              <p class="status-error">{{ errorMessage }}</p>
            }

            <div class="form-actions">
              <button type="button" class="btn btn--secondary" (click)="cancel()">
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn--primary"
                [disabled]="pending || form.invalid"
              >
                {{ pending ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </form>
        </div>
      }
    </div>
  `,
  styles: [`
    .profile-page {
      max-width: 600px;
      margin: 0 auto;
      padding: 1.5rem;
    }

    .profile-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: #6366f1;
      padding: 0.25rem 0.5rem;
    }

    .back-btn:hover { text-decoration: underline; }

    h1 { margin: 0; font-size: 1.5rem; }

    .loading-text { color: #6b7280; }

    .info-section {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.5rem;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      font-size: 0.875rem;
    }

    .info-row + .info-row { border-top: 1px solid #e5e7eb; }

    .info-label { color: #6b7280; }
    .info-value { color: #111827; font-weight: 500; }

    .edit-form { display: flex; flex-direction: column; gap: 1.25rem; }

    .form-field { display: flex; flex-direction: column; gap: 0.375rem; }

    label { font-size: 0.875rem; font-weight: 500; color: #374151; }

    input {
      padding: 0.5rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s ease;
    }

    input:focus { border-color: #6366f1; }

    .field-error { font-size: 0.75rem; color: #dc2626; }

    .status-success { color: #16a34a; font-size: 0.875rem; margin: 0; }
    .status-error   { color: #dc2626; font-size: 0.875rem; margin: 0; }

    .form-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }

    .btn {
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s ease;
    }

    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn--primary { background: #6366f1; color: #fff; }
    .btn--primary:hover:not(:disabled) { background: #4f46e5; }

    .btn--secondary { background: #e5e7eb; color: #374151; }
    .btn--secondary:hover { background: #d1d5db; }
  `]
})
export class ProfileComponent implements OnInit {
  readonly userService = inject(UserService);
  private readonly router = inject(Router);

  pending = false;
  successMessage = '';
  errorMessage = '';

  readonly form = new FormGroup({
    display_name: new FormControl('', [Validators.maxLength(100)]),
    avatar_url: new FormControl('', [Validators.maxLength(500), Validators.pattern(/^https?:\/\/.+/)])
  });

  ngOnInit(): void {
    this.userService.loadUser();
    this.resetFormToUser();
  }

  private resetFormToUser(): void {
    const user = this.userService.user();
    this.form.reset({
      display_name: user?.display_name ?? '',
      avatar_url: user?.avatar_url ?? ''
    });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  save(): void {
    if (this.form.invalid || this.pending) return;

    this.pending = true;
    this.successMessage = '';
    this.errorMessage = '';

    const { display_name, avatar_url } = this.form.value;
    const req: Record<string, string> = {};
    if (display_name !== undefined && display_name !== null) req['display_name'] = display_name;
    if (avatar_url !== undefined && avatar_url !== null) req['avatar_url'] = avatar_url;

    this.userService.updateUser(req).subscribe({
      next: () => {
        this.pending = false;
        this.successMessage = 'Profile updated.';
        this.form.markAsPristine();
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to save. Please try again.';
      }
    });
  }

  cancel(): void {
    this.resetFormToUser();
    this.successMessage = '';
    this.errorMessage = '';
  }

  goBack(): void {
    this.router.navigate(['/today']);
  }
}
