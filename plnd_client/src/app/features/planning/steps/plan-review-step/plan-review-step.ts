import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { CarryoverDecision, DROP_REASONS, DropReason } from '../../../../core/models/week-plan';
import { formatDate, formatWeekDate } from '../../utils/date-format.utils';

const DECISION_CYCLE: CarryoverDecision[] = ['carry', 'defer', 'drop'];

@Component({
  selector: 'app-plan-review-step',
  standalone: true,
  imports: [TitleCasePipe],
  template: `
    <div class="plan-review">
      <h2 class="step-title">Review carry-over items</h2>
      <p class="step-sub">
        Planning
        <span class="week-range">
          {{ formatWeekDate(weekPlanService.planStart()) }} → {{ formatWeekDate(weekPlanService.planEnd()) }}
        </span>
      </p>

      <ul class="carryover-list">
        @for (item of weekPlanService.carryoverItems(); track item.entry_id) {
          <li class="carryover-item">
            <span class="item-title">{{ item.title ?? item.task_type }}</span>
            <span class="item-date">{{ formatDate(item.date) }}</span>
            <button type="button"
                    class="decision-badge"
                    [attr.data-decision]="displayDecision(item.entry_id)"
                    (click)="decide(item.entry_id)">
              {{ displayDecision(item.entry_id) | titlecase }}
              <span class="caret">▾</span>
            </button>
            @if (displayDecision(item.entry_id) === 'drop') {
              <div class="reason-row">
                @for (reason of DROP_REASONS; track reason) {
                  <button type="button"
                          class="reason-chip"
                          [class.selected]="displayReason(item.entry_id) === reason"
                          [attr.aria-pressed]="displayReason(item.entry_id) === reason"
                          (click)="selectReason(item.entry_id, reason)">
                    {{ reason }}
                  </button>
                }
              </div>
            }
          </li>
        }
      </ul>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .plan-review { display: flex; flex-direction: column; gap: 1rem; }

    /* ── List ────────────────────────────────────── */
    .carryover-list { list-style: none; margin: 0; padding: 0;
                      border: 1.5px solid var(--color-border-row); border-radius: 10px;
                      overflow: hidden; background: var(--color-surface-white); }
    .carryover-item { display: flex; align-items: center; gap: 9px;
                      padding: 11px 13px; flex-wrap: wrap;
                      border-bottom: 1px solid var(--color-border-row); }
    .carryover-item:last-child { border-bottom: none; }
    .item-title { flex: 1; font-size: 13px; color: var(--color-text-body); }

    /* ── Date pill ───────────────────────────────── */
    .item-date { font-size: 10px; font-weight: 600; color: var(--color-text-muted);
                 background: var(--color-surface-white); border: 1px solid var(--color-border-row);
                 border-radius: 4px; padding: 2px 7px; white-space: nowrap; }

    /* ── Decision badge ──────────────────────────── */
    .decision-badge { display: inline-flex; align-items: center; gap: 5px;
                      border-radius: 20px; padding: 4px 10px;
                      font-size: 11px; font-weight: 700; border: 1.5px solid;
                      cursor: pointer; white-space: nowrap; min-width: 80px;
                      justify-content: space-between; background: none; }
    .caret { opacity: 0.5; font-size: 9px; }

    .decision-badge[data-decision="carry"] {
      background: var(--color-success-light);
      border-color: var(--color-success-border);
      color: var(--color-success);
    }
    .decision-badge[data-decision="defer"] {
      background: var(--color-accent-light);
      border-color: var(--color-accent-border);
      color: var(--color-accent-dark);
    }
    .decision-badge[data-decision="drop"] {
      background: var(--color-destructive-light);
      border-color: var(--color-destructive-border);
      color: var(--color-destructive);
    }

    /* ── Drop reason chips ───────────────────────────────── */
    .reason-row { display: flex; flex-wrap: wrap; gap: 5px;
                  padding: 6px 13px 10px; width: 100%; }
    .reason-chip { font-size: 10px; font-weight: 600; border-radius: 20px;
                   padding: 3px 9px; border: 1.5px solid var(--color-border-row);
                   background: var(--color-surface-white); color: var(--color-text-muted);
                   cursor: pointer; }
    .reason-chip.selected { background: var(--color-destructive-light);
                            border-color: var(--color-destructive-border);
                            color: var(--color-destructive); }
  `]
})
export class PlanReviewStepComponent {
  readonly weekPlanService = inject(WeekPlanService);
  readonly DROP_REASONS = DROP_REASONS;

  displayDecision(entryId: string): CarryoverDecision {
    return this.weekPlanService.carryoverDecisions()[entryId] ?? 'carry';
  }

  displayReason(entryId: string): string | null {
    return this.weekPlanService.dropReasons()[entryId] ?? null;
  }

  selectReason(entryId: string, reason: DropReason): void {
    this.weekPlanService.setDropReason(entryId, reason);
  }

  decide(entryId: string): void {
    const current = this.displayDecision(entryId);
    const idx = DECISION_CYCLE.indexOf(current);
    const next = DECISION_CYCLE[(idx + 1) % DECISION_CYCLE.length];
    this.weekPlanService.setCarryoverDecision(entryId, next);
  }

  readonly formatDate = formatDate;
  readonly formatWeekDate = formatWeekDate;
}
