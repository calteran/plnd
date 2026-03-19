import { Component, output, signal, computed, effect } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';

type ParsedType = 'task' | 'appointment' | 'exercise';

const EXERCISE_KEYWORDS = /\b(run|walk|jog|cycle|swim|workout|gym|stretch|yoga|hike|bike)\b/i;
const TIME_PATTERN       = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;

@Component({
  selector: 'app-add-entry',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    @if (!isOpen()) {
      <div class="add-row" (click)="open()" role="button" tabindex="0"
           (keydown.enter)="open()" aria-label="Open entry form">
        <div class="gutter"></div>
        <div class="add-checkbox" aria-hidden="true">+</div>
        <span class="add-label">Add something…</span>
      </div>
    } @else {
      <div class="entry-panel">
        <input
          class="entry-input"
          [value]="_text()"
          (input)="_text.set($any($event.target).value)"
          placeholder="e.g. vitamins with breakfast, walk after lunch, dentist 2pm…"
          (keydown.escape)="close()"
          (keydown.enter)="submit()"
          aria-label="Add something to your day"
          autofocus
        />

        @if (parsedType() === 'appointment') {
          <div class="morph-form morph-form--appointment">
            <input class="morph-field" type="time" [formControl]="timeControl" aria-label="Appointment time" />
            <input class="morph-field" [formControl]="locationControl" placeholder="Location (optional)" aria-label="Location" />
          </div>
        }

        @if (parsedType() === 'exercise') {
          <div class="morph-form morph-form--exercise">
            <input class="morph-field" type="number" [formControl]="durationControl"
                   placeholder="Duration (minutes)" aria-label="Duration in minutes" min="1" />
          </div>
        }

        @if (parseHint()) {
          <p class="parse-hint">{{ parseHint() }}</p>
        }

        <div class="entry-actions">
          <button class="btn-cancel" type="button" (click)="close()">Cancel</button>
          <button class="btn-add" type="button" (click)="submit()" [disabled]="!_text().trim()">Add</button>
        </div>
      </div>
    }
  `,
  styleUrl: './add-entry.scss'
})
export class AddEntryComponent {
  readonly added = output<{ label: string; type: ParsedType; time?: string; location?: string; duration?: number }>();

  readonly isOpen          = signal(false);
  // _text is a signal (not FormControl) so computed() tracks it reactively on every keystroke
  protected readonly _text = signal('');
  readonly timeControl     = new FormControl('');
  readonly locationControl = new FormControl('');
  readonly durationControl = new FormControl<number | null>(null);

  constructor() {
    effect(() => {
      this.parsedType(); // track type changes
      this.timeControl.reset('');
      this.locationControl.reset('');
      this.durationControl.reset(null);
    });
  }

  readonly parsedType = computed<ParsedType>(() => {
    const text = this._text();
    if (TIME_PATTERN.test(text)) return 'appointment';
    if (EXERCISE_KEYWORDS.test(text)) return 'exercise';
    return 'task';
  });

  readonly parseHint = computed(() => {
    // Hint logic deferred to LLM integration
    return null;
  });

  open(): void  { this.isOpen.set(true); }
  close(): void { this.isOpen.set(false); this._text.set(''); }

  submit(): void {
    const label = this._text().trim();
    if (!label) return;
    this.added.emit({
      label,
      type: this.parsedType(),
      time:     this.timeControl.value     || undefined,
      location: this.locationControl.value || undefined,
      duration: this.durationControl.value ?? undefined
    });
    this.close();
  }
}
