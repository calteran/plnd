import { Component, inject, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MealAnchor } from '../../../../core/models/schedule';
import { MealSlot, ResolveResponse } from '../../../../core/models/week-plan';
import { MealPlannerAgentService } from '../../../../core/services/meal-planner-agent.service';
import { ScheduleService } from '../../../../core/services/schedule.service';

type ActiveAction = 'swap' | 'edit' | 'add' | null;

@Component({
  selector: 'app-meal-review-pane',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="review-pane">
      <div class="review-header">
        <span class="review-title">{{ meal().name }}</span>
        @if (meal().estimated) {
          <span class="review-subtitle">custom meal · nutrition estimated</span>
        }
      </div>

      @if (meal().nutrition) {
        <div class="nutrition-row">
          <span class="nutrition-chip" [class.nutrition-chip--estimated]="meal().estimated">
            {{ meal().estimated ? '~' : '' }}{{ meal().nutrition!.calories }} kcal
          </span>
          @if (meal().nutrition!.protein_g != null) {
            <span class="nutrition-chip" [class.nutrition-chip--estimated]="meal().estimated">
              {{ meal().estimated ? '~' : '' }}{{ meal().nutrition!.protein_g }}g protein
            </span>
          }
          @if (meal().nutrition!.carbs_g != null) {
            <span class="nutrition-chip" [class.nutrition-chip--estimated]="meal().estimated">
              {{ meal().estimated ? '~' : '' }}{{ meal().nutrition!.carbs_g }}g carbs
            </span>
          }
          @if (meal().nutrition!.fat_g != null) {
            <span class="nutrition-chip" [class.nutrition-chip--estimated]="meal().estimated">
              {{ meal().estimated ? '~' : '' }}{{ meal().nutrition!.fat_g }}g fat
            </span>
          }
        </div>
        @if (meal().estimated) {
          <p class="estimated-note">Estimated from similar catalog meals. Edit to refine.</p>
        }
      }

      @if (meal().description) {
        <div class="dish-list">
          <ul><li>{{ meal().description }}</li></ul>
        </div>
      }

      @if (activeAction()) {
        <div class="resolve-row">
          <input
            class="resolve-input"
            type="text"
            placeholder="Describe a meal…"
            [ngModel]="resolveText()"
            (ngModelChange)="resolveText.set($event)"
          />
          <button class="resolve-submit" (click)="submitResolve()" [disabled]="resolving()">
            {{ resolving() ? '…' : 'Go' }}
          </button>
          <button class="resolve-cancel" (click)="activeAction.set(null)">Cancel</button>
        </div>
      }

      <div class="action-row">
        @if (isFilled()) {
          <button data-action="swap"  (click)="activate('swap')">🔀 Swap</button>
          <button data-action="edit"  (click)="activate('edit')">✏️ Edit</button>
          <button data-action="skip"  (click)="onSkip()">× Skip</button>
          <button data-action="done"  (click)="onDone()">✓ Mark done</button>
        } @else {
          <button data-action="add"     (click)="activate('add')">➕ Add meal</button>
          <button data-action="suggest" (click)="onSuggest()">🔀 Suggest one</button>
          <button data-action="skip"    (click)="onSkip()">× Skip</button>
        }
      </div>
    </div>
  `,
  styleUrl: './meal-review-pane.scss',
})
export class MealReviewPaneComponent {
  readonly meal = input.required<MealAnchor>();
  readonly date = input.required<string>();

  readonly closed   = output<void>();
  readonly skipped  = output<string>();
  readonly doneOut  = output<string>();

  private readonly agentService    = inject(MealPlannerAgentService);
  private readonly scheduleService = inject(ScheduleService);

  readonly activeAction = signal<ActiveAction>(null);
  readonly resolveText  = signal('');
  readonly resolving    = signal(false);

  readonly isFilled = computed(() => this.meal().status !== 'unplanned');

  private occasionFor(meal: MealAnchor): MealSlot {
    return meal.name.toLowerCase() as MealSlot;
  }

  activate(action: ActiveAction): void {
    this.activeAction.set(action);
    this.resolveText.set('');
  }

  submitResolve(): void {
    const text = this.resolveText().trim();
    if (!text) return;
    this.resolving.set(true);
    this.agentService
      .resolveText(text, this.occasionFor(this.meal()), this.date())
      .subscribe({
        next: (_: ResolveResponse) => {
          this.resolving.set(false);
          this.scheduleService.loadDay(this.date());
          this.closed.emit();
        },
        error: () => this.resolving.set(false),
      });
  }

  onSuggest(): void {
    this.resolving.set(true);
    this.agentService
      .suggestSlot(this.date(), this.occasionFor(this.meal()))
      .subscribe({
        next: () => {
          this.resolving.set(false);
          this.scheduleService.loadDay(this.date());
          this.closed.emit();
        },
        error: () => this.resolving.set(false),
      });
  }

  onSkip(): void { this.skipped.emit(this.meal().id); this.closed.emit(); }
  onDone(): void { this.doneOut.emit(this.meal().id); this.closed.emit(); }
}
