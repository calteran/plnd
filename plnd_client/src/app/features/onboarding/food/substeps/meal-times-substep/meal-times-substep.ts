import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { MealPatternService } from '../../../../../core/services/meal-pattern.service';
import { MealPatternEntry, preferredTimeHHMM } from '../../../../../core/models/meal-pattern';

@Component({
  selector: 'app-meal-times-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="meal-times">
      @for (entry of mealPatternService.entries(); track entry.id) {
        <div class="meal-slot-card">
          <div class="card-header">{{ entry.name }}</div>
          <div class="card-body">
            <label class="time-label">Preferred time
              <input type="time" [value]="preferredTimeHHMM(entry.preferred_time)"
                (change)="updateTime(entry, asTime($event))" />
            </label>
            <label class="time-label">Tolerance (min)
              <input type="number" min="0" max="720" [value]="entry.tolerance_minutes"
                (change)="updateTolerance(entry, asNumber($event))" />
            </label>
            <button type="button" class="btn-remove"
              (click)="removeEntry(entry.id)"
              [disabled]="mealPatternService.entries().length <= 1">✕</button>
          </div>
        </div>
      }

      <div class="add-entry-row">
        <input type="text" placeholder="Meal name (e.g. Snack)"
          [value]="newName()" (input)="newName.set(asText($event))" />
        <input type="time" [value]="newTime()"
          (change)="newTime.set(asTime($event))" />
        <button type="button" class="btn-add"
          (click)="addEntry()" [disabled]="!newName().trim()">+ Add meal</button>
      </div>

      <p class="note">Tasks are generally not scheduled during meal windows.</p>
      @if (saveError()) {
        <p class="error">Something went wrong — please try again.</p>
      }
    </div>
  `,
  styles: [`
    .meal-times { display: flex; flex-direction: column; gap: 12px; }
    .meal-slot-card { border: 1.5px solid var(--color-accent-border, #fde68a); border-radius: 10px; overflow: hidden; }
    .card-header { background: var(--color-accent-light, #fef3c7); padding: 8px 14px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--color-accent-dark, #78350f); }
    .card-body { padding: 12px 14px; display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
    .time-label { font-size: 12px; font-weight: 600; color: var(--color-text-body); display: flex; flex-direction: column; gap: 4px; }
    .time-label input { border: 1.5px solid var(--color-accent-border, #fde68a); border-radius: 6px; padding: 5px 8px; font-size: 13px; }
    .btn-remove { background: none; border: none; color: var(--color-destructive); cursor: pointer; font-size: 16px; padding: 4px; }
    .btn-remove:disabled { opacity: 0.35; cursor: default; }
    .add-entry-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 8px 0; }
    .add-entry-row input[type=text] { border: 1.5px solid var(--color-accent-border, #fde68a); border-radius: 6px; padding: 6px 10px; font-size: 13px; flex: 1; min-width: 120px; }
    .add-entry-row input[type=time] { border: 1.5px solid var(--color-accent-border, #fde68a); border-radius: 6px; padding: 6px 8px; font-size: 13px; }
    .btn-add { background: var(--color-accent-light, #fef3c7); border: 1.5px solid var(--color-accent-border, #fde68a); border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer; font-weight: 600; }
    .btn-add:disabled { opacity: 0.4; cursor: default; }
    .note { font-size: 12px; color: var(--color-text-muted); margin: 4px 0 0; }
    .error { color: var(--color-destructive); font-size: 12px; margin: 4px 0 0; }
  `],
})
export class MealTimesSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  protected readonly mealPatternService = inject(MealPatternService);
  protected readonly preferredTimeHHMM = preferredTimeHHMM;

  readonly saveError = signal(false);
  readonly newName = signal('');
  readonly newTime = signal('12:00');

  ngOnInit(): void {
    this.mealPatternService.load();
  }

  protected asTime(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected asText(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected asNumber(event: Event): number {
    return parseInt((event.target as HTMLInputElement).value, 10) || 0;
  }

  protected updateTime(entry: MealPatternEntry, time: string): void {
    this.mealPatternService.update(entry.id, { preferred_time: time }).subscribe({
      error: () => this.saveError.set(true),
    });
  }

  protected updateTolerance(entry: MealPatternEntry, minutes: number): void {
    this.mealPatternService.update(entry.id, { tolerance_minutes: minutes }).subscribe({
      error: () => this.saveError.set(true),
    });
  }

  protected addEntry(): void {
    const name = this.newName().trim();
    if (!name) return;
    const nextOrder = Math.max(0, ...this.mealPatternService.entries().map(e => e.sort_order)) + 1;
    this.mealPatternService.create({
      name,
      preferred_time: this.newTime(),
      sort_order: nextOrder,
    }).subscribe({
      next: () => { this.newName.set(''); this.newTime.set('12:00'); },
      error: () => this.saveError.set(true),
    });
  }

  protected removeEntry(id: string): void {
    if (this.mealPatternService.entries().length <= 1) return;
    this.mealPatternService.delete(id).subscribe({
      error: () => this.saveError.set(true),
    });
  }

  save(): void {
    this.complete.emit();
  }
}
