import { Component, OnInit, inject } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { CarryoverDecision } from '../../../../core/models/week-plan';
import { formatDate, formatWeekDate } from '../../utils/date-format.utils';

const DECISION_CYCLE: CarryoverDecision[] = ['accept', 'defer', 'dismiss'];

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

      @if (loading) {
        <p class="loading-text">Loading…</p>
      } @else if (weekPlanService.carryoverItems().length === 0) {
        <div class="empty-state">
          <span class="empty-emoji">🎉</span>
          <p class="empty-heading">All caught up!</p>
          <p class="empty-sub">No unfinished items from last week to review.</p>
        </div>
      } @else {
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
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .plan-review { display: flex; flex-direction: column; gap: 1rem; }

    /* ── List ────────────────────────────────────── */
    .carryover-list { list-style: none; margin: 0; padding: 0;
                      border: 1.5px solid var(--color-border-row); border-radius: 10px;
                      overflow: hidden; background: var(--color-surface-white); }
    .carryover-item { display: flex; align-items: center; gap: 9px;
                      padding: 11px 13px;
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

    .decision-badge[data-decision="accept"] {
      background: var(--color-success-light);
      border-color: var(--color-success-border);
      color: var(--color-success);
    }
    .decision-badge[data-decision="defer"] {
      background: var(--color-accent-light);
      border-color: var(--color-accent-border);
      color: var(--color-accent-dark);
    }
    .decision-badge[data-decision="dismiss"] {
      background: var(--color-destructive-light);
      border-color: var(--color-destructive-border);
      color: var(--color-destructive);
    }

    /* ── Loading ─────────────────────────────────── */
    .loading-text { font-size: 12px; color: var(--color-text-muted); }

    /* ── Empty state ─────────────────────────────── */
    .empty-state { display: flex; flex-direction: column; align-items: center;
                   gap: 8px; padding: 32px 20px;
                   border: 1.5px solid var(--color-border-row); border-radius: 10px;
                   background: var(--color-surface-white); text-align: center; }
    .empty-emoji { font-size: 36px; line-height: 1; }
    .empty-heading { font-size: 13px; font-weight: 700;
                     color: var(--color-text-primary); margin: 0; }
    .empty-sub { font-size: 12px; color: var(--color-text-muted); margin: 0;
                 max-width: 220px; }
  `]
})
export class PlanReviewStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  loading = true;

  ngOnInit(): void {
    if (!this.weekPlanService.planStart() || !this.weekPlanService.planEnd()) {
      this.loading = false;
      return;
    }
    this.weekPlanService
      .loadPeriod(this.weekPlanService.planStart(), this.weekPlanService.planEnd())
      .subscribe({ next: () => (this.loading = false), error: () => (this.loading = false) });
  }

  displayDecision(entryId: string): CarryoverDecision {
    return this.weekPlanService.carryoverDecisions()[entryId] ?? 'accept';
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
