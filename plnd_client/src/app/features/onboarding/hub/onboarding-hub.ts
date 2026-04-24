import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs/operators';
import { OnboardingStateService, SectionId } from '../onboarding-state.service';
import { ConfigService } from '../../../core/services/config.service';
import { UserService } from '../../../core/services/user.service';
import {
  PostSchedulePlanRequest,
  PostSchedulePlanResponse,
  PlanEntryRequest,
} from '../../../core/models/week-plan';

interface HubSection {
  id: SectionId | 'exercise';
  icon: string;
  title: string;
  description: string;
  route: string;
  disabled: boolean;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const SLOT_DEFAULT_TIME: Record<string, string> = {
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  snack: '15:00',
};

const HUB_SECTIONS: HubSection[] = [
  {
    id: 'account',
    icon: '👤',
    title: 'Account Settings',
    description: 'Display name and notifications',
    route: '/onboarding/account',
    disabled: false,
  },
  {
    id: 'tasks',
    icon: '📋',
    title: 'Tasks & Routines',
    description: 'Recurring routines and upcoming tasks',
    route: '/onboarding/tasks',
    disabled: false,
  },
  {
    id: 'food',
    icon: '🥗',
    title: 'Food & Meals',
    description: 'Dietary needs and first meal plan',
    route: '/onboarding/food',
    disabled: false,
  },
  {
    id: 'exercise',
    icon: '🏃',
    title: 'Exercise',
    description: 'Coming in a future update',
    route: '',
    disabled: true,
  },
];

@Component({
  selector: 'app-onboarding-hub',
  standalone: true,
  imports: [],
  template: `
    <div class="hub" [class.hub--submitting]="isSubmitting()">
      <header class="hub-header">
        <h1 class="hub-title">Welcome to PLND!</h1>
        <p class="hub-subtitle">Complete sections in any order</p>
      </header>

      <div class="section-grid">
        @for (section of sections; track section.id) {
          <button
            class="section-card"
            [class.section-card--done]="statusFor(section) === 'complete'"
            [class.section-card--disabled]="section.disabled"
            type="button"
            [disabled]="section.disabled"
            [attr.aria-disabled]="section.disabled ? true : null"
            (click)="navigate(section)">

            <span class="card-icon" aria-hidden="true">{{ section.icon }}</span>

            <div class="card-body">
              <span class="card-title">{{ section.title }}</span>
              <span class="card-desc">{{ section.description }}</span>
            </div>

            <span class="card-badge"
                  [class.badge--done]="statusFor(section) === 'complete'"
                  [class.badge--muted]="statusFor(section) === 'not-started'"
                  [class.badge--disabled]="section.disabled">
              @if (statusFor(section) === 'complete') {
                ✓ done
              } @else if (section.disabled) {
                coming soon
              } @else {
                not started
              }
            </span>
          </button>
        }
      </div>

      @if (allDone()) {
        <div class="stats-banner">
          <p class="stats-heading">Everything looks good</p>
          <div class="stats-row">
            <div class="stat">
              <span class="stat-label">Routines</span>
              <span class="stat-value">{{ onboardingState.totalRoutines() }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Tasks</span>
              <span class="stat-value">{{ onboardingState.totalTasks() }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Meals</span>
              <span class="stat-value">{{ onboardingState.totalMeals() }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Days</span>
              <span class="stat-value">{{ onboardingState.planDays() }}</span>
            </div>
          </div>
        </div>
      }

      @if (commitError()) {
        <div class="commit-error" role="alert">
          Something went wrong — your plan wasn't saved. Please try again.
        </div>
      }

      <div class="hub-cta">
        @if (!allDone()) {
          <button
            class="btn-skip"
            type="button"
            (click)="showSkipModal.set(true)">
            Skip
          </button>
          <button
            class="btn-cta btn--ghost btn--disabled"
            type="button"
            disabled
            aria-disabled="true">
            Approve Plan →
          </button>
        } @else {
          <button
            class="btn-cta btn--accent"
            type="button"
            [disabled]="isSubmitting()"
            (click)="commitPlan()">
            @if (isSubmitting()) {
              <span class="spinner" aria-hidden="true"></span>
              Saving…
            } @else {
              Approve Plan →
            }
          </button>
        }
      </div>
    </div>

    @if (showSkipModal()) {
      <div class="modal-backdrop" (click)="showSkipModal.set(false)">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <h2 class="modal-title">Skip setup for now?</h2>
          <p class="modal-body">Your progress is saved. You can add more detail anytime from <strong>Settings</strong>.</p>
          <div class="modal-actions">
            <button class="btn-ghost-amber" type="button" (click)="showSkipModal.set(false)">
              Keep going
            </button>
            <button class="btn-gray-primary" type="button" (click)="skipOnboarding()">
              Skip for now
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* ── Page shell ─────────────────────────────── */
    .hub {
      max-width: 560px;
      margin: 0 auto;
      padding: 32px 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* ── Header ─────────────────────────────────── */
    .hub-header { text-align: center; }
    .hub-title {
      margin: 0 0 6px;
      font-size: 24px;
      font-weight: 800;
      color: var(--color-text-primary);
      letter-spacing: -0.02em;
    }
    .hub-subtitle {
      margin: 0;
      font-size: 13px;
      color: var(--color-text-muted);
    }

    /* ── Section grid ───────────────────────────── */
    .section-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── Section card ───────────────────────────── */
    .section-card {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 14px 16px;
      background: var(--color-surface-white);
      border: 1.5px solid var(--color-border-row);
      border-radius: 10px;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .section-card:hover:not([disabled]) {
      border-color: var(--color-accent-border);
      box-shadow: var(--shadow-dropdown);
    }
    .section-card:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: 2px;
    }
    .section-card--done {
      background: var(--color-surface-warm);
      border-color: var(--color-accent-border);
    }
    .section-card--disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* ── Card icon ──────────────────────────────── */
    .card-icon {
      font-size: 22px;
      line-height: 1;
      flex-shrink: 0;
    }

    /* ── Card body ──────────────────────────────── */
    .card-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .card-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .card-desc {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    /* ── Badge ──────────────────────────────────── */
    .card-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
      flex-shrink: 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge--muted {
      background: var(--color-surface-base);
      border: 1px solid var(--color-border-row);
      color: var(--color-text-muted);
    }
    .badge--done {
      background: var(--color-success-light);
      border: 1px solid var(--color-success-border);
      color: var(--color-success);
    }
    .badge--disabled {
      background: var(--color-surface-base);
      border: 1px solid var(--color-border-row);
      color: var(--color-text-muted);
    }

    /* Hub submitting state — dim cards and stats banner */
    .hub--submitting .section-grid,
    .hub--submitting .stats-banner {
      opacity: 0.6;
      pointer-events: none;
      transition: opacity 0.2s;
    }

    /* Stats banner */
    .stats-banner {
      background: #fef3c7;
      border: 1.5px solid #fde68a;
      border-radius: 10px;
      padding: 16px;
      animation: slide-fade-in 0.3s ease-out;
    }
    .stats-heading {
      margin: 0 0 12px;
      font-size: 13px;
      font-weight: 700;
      color: #78350f;
      text-align: center;
    }
    .stats-row {
      display: flex;
      align-items: stretch;
    }
    .stat {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 0 12px;
    }
    .stat + .stat {
      border-left: 1px solid #fde68a;
    }
    .stat-label {
      font-size: 10px;
      font-weight: 600;
      color: #92400e;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stat-value {
      font-size: 20px;
      font-weight: 800;
      color: #78350f;
    }

    @keyframes slide-fade-in {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Error banner */
    .commit-error {
      background: #fef3c7;
      border: 1.5px solid #fde68a;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      color: #92400e;
    }

    /* CTA button row */
    .hub-cta {
      display: flex;
      gap: 10px;
      align-items: stretch;
      padding-top: 4px;
    }

    /* Skip button */
    .btn-skip {
      all: unset;
      box-sizing: border-box;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      color: #6b7280;
      border: 1.5px solid #e5e7eb;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-skip:hover {
      background: #f9fafb;
    }

    /* CTA full-width when alone */
    .btn-cta {
      all: unset;
      box-sizing: border-box;
      flex: 1;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      cursor: pointer;
      transition: opacity 0.12s, background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btn-cta:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: 2px;
    }
    .btn--ghost {
      background: transparent;
      border: 1.5px solid #fde68a;
      color: #b45309;
      opacity: 0.5;
    }
    .btn--disabled {
      cursor: not-allowed;
    }
    .btn--accent {
      background: #d97706;
      border: 1.5px solid transparent;
      color: #ffffff;
    }
    .btn--accent:hover:not([disabled]) {
      opacity: 0.88;
    }
    .btn--accent[disabled] {
      opacity: 0.7;
      cursor: not-allowed;
    }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Modal backdrop */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(254, 249, 240, 0.88);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    /* Modal card */
    .modal-card {
      background: #ffffff;
      border: 1.5px solid #fde68a;
      border-radius: 10px;
      padding: 24px;
      max-width: 360px;
      width: 90%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .modal-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #78350f;
    }
    .modal-body {
      margin: 0;
      font-size: 13px;
      color: #374151;
      line-height: 1.5;
    }
    .modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      padding-top: 4px;
    }
    .btn-ghost-amber {
      all: unset;
      box-sizing: border-box;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      border: 1.5px solid #fde68a;
      color: #b45309;
      cursor: pointer;
    }
    .btn-ghost-amber:hover {
      background: #fef3c7;
    }
    .btn-gray-primary {
      all: unset;
      box-sizing: border-box;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      background: #6b7280;
      color: #ffffff;
      cursor: pointer;
    }
    .btn-gray-primary:hover {
      background: #4b5563;
    }
  `],
})
export class OnboardingHubComponent {
  protected readonly onboardingState = inject(OnboardingStateService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);
  private readonly userService = inject(UserService);

  protected readonly isSubmitting = signal(false);
  protected readonly commitError  = signal(false);
  protected readonly showSkipModal = signal(false);

  readonly sections = HUB_SECTIONS;
  readonly allDone = this.onboardingState.allSectionsComplete;

  statusFor(section: HubSection): 'not-started' | 'complete' | null {
    if (section.disabled) return null;
    return this.onboardingState.sectionStatus()[section.id as SectionId];
  }

  navigate(section: HubSection): void {
    if (section.disabled || !section.route) return;
    this.router.navigate([section.route]);
  }

  commitPlan(): void {
    const period = this.onboardingState.planPeriod();
    if (!period || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.commitError.set(false);

    const mealPlan = this.onboardingState.mealPlan();
    const entries: PlanEntryRequest[] = (mealPlan?.meals ?? []).map(m => ({
      date: m.date,
      task_type: 'meal',
      task_ref_id: m.meal_ref?.id,
      task_ref_type: m.meal_ref?.type,
      title: m.meal_ref ? undefined : m.title,
      scheduled_start: SLOT_DEFAULT_TIME[m.occasion] ?? '12:00',
      after_milepost: m.occasion,
    }));

    const body: PostSchedulePlanRequest = {
      plan_start: period.start,
      plan_end: period.end,
      planning_task_id: NIL_UUID,
      entries,
      placed_tasks: this.onboardingState.placedTasks(),
      meal_habit_ids: this.onboardingState.mealHabits().map(h => h.id),
    };

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.post<PostSchedulePlanResponse>(`${apiBase}/schedule/plan`, body)
      .pipe(switchMap(() => this.userService.completeOnboarding()))
      .subscribe({
        next: () => this.router.navigate(['/day', period.start]),
        error: () => {
          this.isSubmitting.set(false);
          this.commitError.set(true);
        },
      });
  }

  skipOnboarding(): void {
    const today = new Date().toISOString().split('T')[0];
    this.router.navigate(['/day', today]);
  }
}
