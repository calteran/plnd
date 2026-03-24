import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { CarryoverDecision } from '../../../../core/models/week-plan';

@Component({
  selector: 'app-plan-review-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plan-review">
      <h2>Review carry-over items</h2>
      <p class="subtitle">
        Planning
        <strong>{{ weekPlanService.planStart() }}</strong>
        →
        <strong>{{ weekPlanService.planEnd() }}</strong>
      </p>

      @if (loading) {
        <p>Loading…</p>
      } @else if (weekPlanService.carryoverItems().length === 0) {
        <p class="empty-state">Nothing to carry over — you're all caught up!</p>
      } @else {
        <ul class="carryover-list">
          @for (item of weekPlanService.carryoverItems(); track item.entry_id) {
            <li class="carryover-item">
              <span class="item-title">{{ item.title ?? item.task_type }}</span>
              <span class="item-date">{{ item.date }}</span>
              <span class="item-actions">
                <button type="button" data-action="accept"
                        [class.selected]="decision(item.entry_id) === 'accept'"
                        (click)="decide(item.entry_id, 'accept')">Accept</button>
                <button type="button" data-action="defer"
                        [class.selected]="decision(item.entry_id) === 'defer'"
                        (click)="decide(item.entry_id, 'defer')">Defer</button>
                <button type="button" data-action="dismiss"
                        [class.selected]="decision(item.entry_id) === 'dismiss'"
                        (click)="decide(item.entry_id, 'dismiss')">Dismiss</button>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `
})
export class PlanReviewStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  loading = true;

  ngOnInit(): void {
    if (!this.weekPlanService.planStart()) {
      this.loading = false;
      return;
    }
    this.weekPlanService
      .loadPeriod(this.weekPlanService.planStart(), this.weekPlanService.planEnd())
      .subscribe({ next: () => (this.loading = false), error: () => (this.loading = false) });
  }

  decision(entryId: string): CarryoverDecision | undefined {
    return this.weekPlanService.carryoverDecisions()[entryId];
  }

  decide(entryId: string, d: CarryoverDecision): void {
    this.weekPlanService.setCarryoverDecision(entryId, d);
  }
}
