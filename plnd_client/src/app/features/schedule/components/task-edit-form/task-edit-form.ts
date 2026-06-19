import { Component, ElementRef, afterNextRender, computed, effect, input, output, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { ItemType, ScheduleTask, TaskEditPatch } from '../../../../core/models/schedule';
import { EnergyLevel } from '../../../../core/models/week-plan';

const TYPES: { value: ItemType; label: string }[] = [
  { value: 'work', label: 'Work' }, { value: 'exercise', label: 'Exercise' },
  { value: 'leisure', label: 'Leisure' }, { value: 'medication', label: 'Medication' },
  { value: 'appointment', label: 'Appointment' }, { value: 'general', label: 'General' },
];
const ENERGIES: EnergyLevel[] = ['low', 'medium', 'high'];

@Component({
  selector: 'app-task-edit-form',
  standalone: true,
  imports: [TitleCasePipe],
  template: `
    <div class="task-edit-form" role="group" [attr.aria-label]="'Edit task: ' + task().label"
         (keydown.escape)="closed.emit()">
      <label class="field">
        <span class="field-label">Title</span>
        <input #titleInput name="title" type="text" [value]="task().label"
               (input)="title.set($any($event.target).value)"
               (blur)="commitTitle()" />
      </label>

      <label class="field">
        <span class="field-label">Type</span>
        <select name="type" [value]="task().type"
                (change)="save.emit({ type: $any($event.target).value })">
          @for (t of types; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
        </select>
      </label>

      <label class="field">
        <span class="field-label">Time</span>
        <input name="time" type="time" [value]="task().scheduledStart ?? ''"
               [disabled]="task().floating"
               [attr.aria-describedby]="task().floating ? 'time-hint' : null"
               (change)="commitTime($any($event.target).value)" />
        @if (task().floating) { <span id="time-hint" class="hint">set by its meal slot</span> }
      </label>

      <label class="field">
        <span class="field-label">Duration (min)</span>
        <input name="duration" type="number" min="1" step="1" [value]="task().durationMinutes ?? ''"
               (change)="commitDuration($any($event.target).value)" />
      </label>

      <label class="field">
        <span class="field-label">Energy</span>
        <select name="energy" [value]="task().energy ?? ''"
                (change)="save.emit({ energy: $any($event.target).value })">
          @if (!task().energy) { <option value="" disabled hidden>Not set</option> }
          @for (e of energies; track e) { <option [value]="e">{{ e | titlecase }}</option> }
        </select>
      </label>

      <button type="button" class="one-shot-toggle" role="switch"
              [attr.aria-checked]="task().oneShot"
              [attr.aria-label]="oneShotLabel()"
              (click)="save.emit({ oneShot: !task().oneShot })">
        <span class="one-shot-text" aria-hidden="true">skip if missed</span>
      </button>

      <button type="button" class="done-edit" (click)="closed.emit()">Done</button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './task-edit-form.scss',
})
export class TaskEditFormComponent {
  readonly task = input.required<ScheduleTask>();
  readonly save = output<TaskEditPatch>();
  readonly closed = output<void>();

  protected readonly types = TYPES;
  protected readonly energies = ENERGIES;
  protected readonly title = signal('');

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  protected readonly oneShotLabel = computed(() =>
    this.task().oneShot
      ? `${this.task().label} will skip if missed — won't carry over if not done. Turn off to carry over.`
      : `${this.task().label} will carry over if not done. Turn on to skip if missed.`,
  );

  constructor() {
    effect(() => this.title.set(this.task().label));
    // The form is re-created each time a row opens, so this focuses the title
    // input once per open. (Focus restoration on close lives in DayViewComponent.)
    afterNextRender(() => this.titleInput()?.nativeElement.focus());
  }

  protected commitTime(raw: string): void {
    // Empty value → no emit. Clearing a fixed time isn't supported here; this
    // avoids a silent 400/revert when the field is cleared. The value check
    // skips a redundant PATCH when the time is re-submitted unchanged.
    if (raw && raw !== this.task().scheduledStart) this.save.emit({ scheduledStart: raw });
  }

  protected commitTitle(): void {
    const next = this.title().trim();
    if (next && next !== this.task().label) this.save.emit({ title: next });
  }

  protected commitDuration(raw: string): void {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n !== this.task().durationMinutes) {
      this.save.emit({ durationMinutes: n });
    }
  }
}
