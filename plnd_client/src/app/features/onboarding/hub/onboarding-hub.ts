import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { OnboardingStateService, SectionId } from '../onboarding-state.service';

interface HubSection {
  id: SectionId | 'exercise';
  icon: string;
  title: string;
  description: string;
  route: string;
  disabled: boolean;
}

const HUB_SECTIONS: HubSection[] = [
  {
    id: 'account',
    icon: '👤',
    title: 'Account',
    description: 'Set up your display name and wake time.',
    route: '/onboarding/account',
    disabled: false,
  },
  {
    id: 'tasks',
    icon: '📋',
    title: 'Tasks & Routines',
    description: 'Set your planning cadence and add recurring tasks.',
    route: '/onboarding/tasks',
    disabled: false,
  },
  {
    id: 'food',
    icon: '🍽️',
    title: 'Food & Meals',
    description: 'Add dietary preferences and generate your first meal plan.',
    route: '/onboarding/food',
    disabled: false,
  },
  {
    id: 'exercise',
    icon: '🏃',
    title: 'Exercise',
    description: 'Exercise tracking — coming in a future update.',
    route: '',
    disabled: true,
  },
];

@Component({
  selector: 'app-onboarding-hub',
  standalone: true,
  imports: [],
  template: `
    <div class="hub">
      <header class="hub-header">
        <h1 class="hub-title">Welcome to PLND!</h1>
        <p class="hub-subtitle">Complete each section to build your first week.</p>
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

      <div class="hub-cta">
        <button
          class="btn-cta"
          [class.btn--accent]="allDone()"
          [class.btn--ghost]="!allDone()"
          type="button"
          (click)="goToReview()">
          Review &amp; Build My First Week →
        </button>
        <p class="hub-note">Future planning happens in the weekly planning wizard.</p>
      </div>
    </div>
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

    /* ── CTA area ───────────────────────────────── */
    .hub-cta {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      padding-top: 4px;
    }
    .btn-cta {
      all: unset;
      box-sizing: border-box;
      width: 100%;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      cursor: pointer;
      transition: opacity 0.12s, background 0.15s;
    }
    .btn-cta:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: 2px;
    }
    .btn--ghost {
      background: transparent;
      border: 1.5px solid var(--color-accent-border);
      color: var(--color-text-secondary);
    }
    .btn--ghost:hover {
      background: var(--color-accent-light);
    }
    .btn--accent {
      background: var(--color-accent);
      border: 1.5px solid transparent;
      color: var(--color-btn-accent-text);
    }
    .btn--accent:hover {
      opacity: 0.88;
    }
    .hub-note {
      margin: 0;
      font-size: 11px;
      color: var(--color-text-muted);
      text-align: center;
    }
  `],
})
export class OnboardingHubComponent {
  private readonly onboardingState = inject(OnboardingStateService);
  private readonly router = inject(Router);

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

  goToReview(): void {
    this.router.navigate(['/onboarding/review']);
  }
}
