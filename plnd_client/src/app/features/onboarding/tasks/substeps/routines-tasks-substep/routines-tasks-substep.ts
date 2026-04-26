import {
  Component,
  EventEmitter,
  OnInit,
  Output,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScheduleTemplatesService } from '../../../../../core/services/schedule-templates.service';
import { ScheduleTemplate, CreateScheduleTemplateRequest, UpdateScheduleTemplateRequest } from '../../../../../core/models/schedule-template';
import { OnboardingStateService } from '../../../onboarding-state.service';

// ── Recurrence dropdown option ───────────────────────────────────────────────

interface RecurrenceOption {
  value: string;  // rrule string
  label: string;
}

const RECURRENCE_OPTIONS: RecurrenceOption[] = [
  { value: 'FREQ=DAILY',                             label: 'Every day' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',      label: 'Weekdays' },
  { value: 'FREQ=WEEKLY;BYDAY=SA,SU',                label: 'Weekends' },
  { value: 'FREQ=WEEKLY;BYDAY=',                     label: 'Weekly…' },
];

// ── Day-of-week pills for "Weekly…" selector ─────────────────────────────────

interface DayOption {
  byday: string;   // RRULE BYDAY abbreviation
  label: string;   // single-letter display
}

const DAY_OPTIONS: DayOption[] = [
  { byday: 'MO', label: 'M' },
  { byday: 'TU', label: 'T' },
  { byday: 'WE', label: 'W' },
  { byday: 'TH', label: 'T' },
  { byday: 'FR', label: 'F' },
  { byday: 'SA', label: 'S' },
  { byday: 'SU', label: 'S' },
];

// ── Inspiration chips ────────────────────────────────────────────────────────

interface InspirationChip {
  id: string;
  name: string;
  rrule: string;
  emoji: string;
}

const INSPIRATION_CHIPS: InspirationChip[] = [
  { id: 'morning-walk',  name: 'Morning walk', rrule: 'FREQ=DAILY', emoji: '🌅' },
  { id: 'medication',    name: 'Medication',   rrule: 'FREQ=DAILY', emoji: '💊' },
  { id: 'journal',       name: 'Journal',      rrule: 'FREQ=DAILY', emoji: '📓' },
  { id: 'brush-teeth',   name: 'Brush teeth',  rrule: 'FREQ=DAILY', emoji: '🦷' },
  { id: 'meditate',      name: 'Meditate',     rrule: 'FREQ=DAILY', emoji: '🧘' },
  { id: 'wind-down',     name: 'Wind down',    rrule: 'FREQ=DAILY', emoji: '🛏' },
  { id: 'walk-the-dog',  name: 'Walk the dog', rrule: 'FREQ=DAILY', emoji: '🐕' },
];

// ── Local routine entry (in-progress form state) ─────────────────────────────

/** Map an rrule string to a short human-readable chip label. */
export function rruleToHumanLabel(rrule: string): string {
  if (rrule === 'FREQ=DAILY')                         return 'daily';
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')  return 'weekdays';
  if (rrule === 'FREQ=WEEKLY;BYDAY=SA,SU')            return 'weekends';
  if (rrule.startsWith('FREQ=WEEKLY;BYDAY=')) {
    const byday = rrule.replace('FREQ=WEEKLY;BYDAY=', '');
    const day = DAY_OPTIONS.find(d => d.byday === byday);
    if (day) {
      const name = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }[byday] ?? byday;
      return `weekly · ${name}`;
    }
    return 'weekly';
  }
  return rrule;
}

/** Parse a stored rrule string back into the form's (selectedRrule, selectedWeekDay) pair. */
function rruleToFormState(rrule: string): { selectedRrule: string; selectedWeekDay: string } {
  if (rrule === 'FREQ=DAILY') return { selectedRrule: 'FREQ=DAILY', selectedWeekDay: 'MO' };
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return { selectedRrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', selectedWeekDay: 'MO' };
  if (rrule === 'FREQ=WEEKLY;BYDAY=SA,SU') return { selectedRrule: 'FREQ=WEEKLY;BYDAY=SA,SU', selectedWeekDay: 'MO' };
  if (rrule.startsWith('FREQ=WEEKLY;BYDAY=')) {
    const byday = rrule.replace('FREQ=WEEKLY;BYDAY=', '');
    return { selectedRrule: 'FREQ=WEEKLY;BYDAY=', selectedWeekDay: byday || 'MO' };
  }
  return { selectedRrule: 'FREQ=DAILY', selectedWeekDay: 'MO' };
}

/** Map an rrule string to the RecurrenceType expected by the API. */
function rruleToRecurrenceType(rrule: string): 'daily' | 'weekdays' | 'weekly' | 'custom' {
  if (rrule === 'FREQ=DAILY')                        return 'daily';
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (rrule.startsWith('FREQ=WEEKLY;BYDAY='))        return 'weekly';
  return 'custom';
}

@Component({
  selector: 'app-routines-tasks-substep',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="routines-tasks-substep">

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- Section 1: Recurring Routines                                   -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <section class="section">
        <p class="section-subtitle">Things you do on a regular schedule.</p>

        <!-- Entry form -->
        <div class="entry-form">
          <input
            type="text"
            class="name-input"
            placeholder="Routine name…"
            [(ngModel)]="routineName"
            aria-label="Routine name"
          />
          <div class="recurrence-row">
            <select
              class="recurrence-select"
              [(ngModel)]="selectedRrule"
              aria-label="Recurrence"
            >
              @for (opt of recurrenceOptions; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </div>

          @if (isWeeklySelected) {
            <div class="day-row" role="group" aria-label="Day of week">
              @for (day of dayOptions; track day.byday) {
                <button
                  type="button"
                  class="day-pill"
                  [class.day-pill--active]="selectedWeekDay === day.byday"
                  (click)="selectWeekDay(day.byday)"
                  [attr.aria-label]="day.byday"
                  [attr.aria-pressed]="selectedWeekDay === day.byday"
                >{{ day.label }}</button>
              }
            </div>
          }

          <button
            type="button"
            class="add-btn"
            [disabled]="!routineName.trim() || isAdding()"
            (click)="addRoutine()"
          >+ Add</button>

          @if (addError()) {
            <p class="add-error" role="alert">{{ addError() }}</p>
          }
        </div>

        <!-- Inspiration chips -->
        @if (availableInspirationChips().length > 0) {
          <div class="inspiration-block">
            <span class="inspiration-label">Inspiration</span>
            <div class="chip-row">
              @for (chip of availableInspirationChips(); track chip.id) {
                <button
                  type="button"
                  class="inspiration-chip"
                  (click)="addInspirationChip(chip)"
                  [attr.aria-label]="'Add ' + chip.name"
                >{{ chip.emoji }} {{ chip.name }}</button>
              }
            </div>
          </div>
        }

        <!-- Added routines -->
        @if (routines().length > 0) {
          <div class="added-chips" aria-label="Added routines">
            @for (routine of routines(); track routine.localId) {
              @if (editingId() === routine.localId) {
                <div class="routine-edit-card">
                  <input
                    type="text"
                    class="name-input"
                    [(ngModel)]="editTitle"
                    aria-label="Routine name"
                  />
                  <div class="recurrence-row">
                    <select
                      class="recurrence-select"
                      [(ngModel)]="editSelectedRrule"
                      aria-label="Recurrence"
                    >
                      @for (opt of recurrenceOptions; track opt.value) {
                        <option [value]="opt.value">{{ opt.label }}</option>
                      }
                    </select>
                  </div>
                  @if (isEditWeeklySelected) {
                    <div class="day-row" role="group" aria-label="Day of week">
                      @for (day of dayOptions; track day.byday) {
                        <button
                          type="button"
                          class="day-pill"
                          [class.day-pill--active]="editSelectedWeekDay === day.byday"
                          (click)="editSelectedWeekDay = day.byday"
                          [attr.aria-label]="day.byday"
                          [attr.aria-pressed]="editSelectedWeekDay === day.byday"
                        >{{ day.label }}</button>
                      }
                    </div>
                  }
                  <div class="edit-actions">
                    <button
                      type="button"
                      class="add-btn"
                      [disabled]="!editTitle.trim() || isSaving()"
                      (click)="saveEdit(routine)"
                    >Save</button>
                    <button
                      type="button"
                      class="cancel-btn"
                      (click)="cancelEdit()"
                    >Cancel</button>
                  </div>
                  @if (saveError()) {
                    <p class="add-error" role="alert">{{ saveError() }}</p>
                  }
                </div>
              } @else {
                <span class="routine-chip">
                  <button
                    type="button"
                    class="chip-body chip-body--clickable"
                    (click)="openEdit(routine)"
                    [attr.aria-label]="'Edit ' + routine.name"
                  >{{ routine.name }} · {{ rruleToHumanLabel(routine.rrule) }}</button>
                  <button
                    type="button"
                    class="chip-remove"
                    (click)="removeRoutine(routine.localId)"
                    [attr.aria-label]="'Remove ' + routine.name"
                  >✕</button>
                </span>
              }
            }
          </div>
        }
      </section>

      <hr class="divider" />

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- Section 2: Upcoming Tasks                                       -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <section class="section">
        <p class="section-subtitle">One-off things to get done in your planning period. Duration and timing set in the next step.</p>

        <!-- Entry form -->
        <div class="entry-form">
          <input
            type="text"
            class="name-input"
            placeholder="Task name…"
            [(ngModel)]="taskName"
            aria-label="Task name"
          />
          <button
            type="button"
            class="add-btn"
            [disabled]="!taskName.trim()"
            (click)="addTask()"
          >+ Add</button>
        </div>

        <!-- Added tasks -->
        @if (taskNames().length > 0) {
          <div class="added-chips" aria-label="Added tasks">
            @for (name of taskNames(); track $index; let i = $index) {
              <span class="routine-chip">
                <span class="chip-body" role="note">{{ name }}</span>
                <button
                  type="button"
                  class="chip-remove"
                  (click)="removeTask(i)"
                  [attr.aria-label]="'Remove ' + name"
                >✕</button>
              </span>
            }
          </div>
        }
      </section>

      <!-- Save & Continue -->
      <button
        type="button"
        class="save-btn"
        (click)="save()"
      >Save &amp; Continue →</button>

    </div>
  `,
  styles: [`
    .routines-tasks-substep {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-subtitle {
      margin: 0;
      font-size: 13px;
      color: var(--color-text-primary);
    }

    .entry-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .name-input {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 14px;
      color: var(--color-text-primary);
      background: var(--color-surface-white);
      outline: none;
    }

    .name-input:focus {
      border-color: var(--color-accent);
    }

    .recurrence-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .recurrence-select {
      flex: 1;
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 13px;
      color: var(--color-text-primary);
      background: var(--color-surface-white);
      outline: none;
    }

    .recurrence-select:focus {
      border-color: var(--color-accent);
    }

    .day-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .day-pill {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1.5px solid var(--color-btn-neutral-border);
      background: var(--color-surface-base);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: var(--color-text-body);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .day-pill--active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-btn-accent-text);
    }

    .add-btn {
      align-self: flex-start;
      background: var(--color-accent);
      color: var(--color-btn-accent-text);
      border: none;
      border-radius: 6px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.15s;
    }

    .add-btn:hover:not([disabled]) {
      filter: brightness(0.88);
    }

    .add-btn[disabled] {
      background: var(--color-accent-border);
      color: var(--color-text-primary);
      cursor: not-allowed;
      opacity: 0.6;
    }

    .add-error {
      margin: 0;
      font-size: 12px;
      color: var(--color-destructive);
    }

    .inspiration-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .inspiration-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .inspiration-chip {
      background: var(--color-surface-warm);
      border: 1.5px solid var(--color-accent-border);
      border-radius: 20px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--color-text-primary);
      cursor: pointer;
      transition: background 0.15s;
    }

    .inspiration-chip:hover {
      background: var(--color-accent-light);
    }

    .added-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .routine-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--color-accent-light);
      border: 1.5px solid var(--color-accent-border);
      border-radius: 20px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--color-text-primary);
    }

    .chip-body {
      font-size: 12px;
    }

    .chip-body--clickable {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--color-text-primary);
      font-size: 12px;
      text-align: left;
    }

    .chip-body--clickable:hover {
      text-decoration: underline;
    }

    .chip-remove {
      background: none;
      border: none;
      padding: 0 2px;
      cursor: pointer;
      font-size: 11px;
      color: var(--color-accent-dark);
      line-height: 1;
    }

    .chip-remove:hover {
      color: var(--color-destructive);
    }

    .routine-edit-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      background: var(--color-surface-warm);
      border: 1.5px solid var(--color-accent-border);
      border-radius: 8px;
      padding: 10px 12px;
    }

    .edit-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .cancel-btn {
      background: none;
      border: 1.5px solid var(--color-btn-neutral-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      color: var(--color-btn-neutral-text);
      cursor: pointer;
    }

    .cancel-btn:hover {
      background: var(--color-surface-base);
    }

    .divider {
      border: none;
      border-top: 1.5px solid var(--color-accent-border);
      margin: 0;
    }

    .save-btn {
      align-self: flex-end;
      background: var(--color-accent);
      color: var(--color-btn-accent-text);
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: filter 0.15s;
    }

    .save-btn:hover:not([disabled]) {
      filter: brightness(0.88);
    }
  `],
})
export class RoutinesTasksSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  private readonly templatesService = inject(ScheduleTemplatesService);
  private readonly stateService = inject(OnboardingStateService);

  // ── Public constants used in the template ────────────────────────────────
  readonly recurrenceOptions = RECURRENCE_OPTIONS;
  readonly dayOptions = DAY_OPTIONS;
  readonly rruleToHumanLabel = rruleToHumanLabel;

  // ── Routine form state ────────────────────────────────────────────────────
  routineName = '';
  selectedRrule = 'FREQ=DAILY';
  selectedWeekDay = 'MO';

  get isWeeklySelected(): boolean {
    return this.selectedRrule === 'FREQ=WEEKLY;BYDAY=';
  }

  // ── Loading / error state ─────────────────────────────────────────────────
  readonly isAdding = signal(false);
  readonly addError = signal('');

  // ── Inline edit state ─────────────────────────────────────────────────────
  readonly editingId = signal<string | null>(null);
  editTitle = '';
  editSelectedRrule = 'FREQ=DAILY';
  editSelectedWeekDay = 'MO';
  readonly isSaving = signal(false);
  readonly saveError = signal('');

  get isEditWeeklySelected(): boolean {
    return this.editSelectedRrule === 'FREQ=WEEKLY;BYDAY=';
  }

  // ── Task form state ───────────────────────────────────────────────────────
  taskName = '';
  readonly taskNames = signal<string[]>([]);

  // ── Local routine chip state ──────────────────────────────────────────────
  /** Local representation of a routine (backed by a ScheduleTemplate server record). */
  readonly routines = signal<{ localId: string; name: string; rrule: string; templateId: string | null }[]>([]);

  // ── Inspiration chips: hidden once tapped ────────────────────────────────
  private readonly usedInspirationIds = signal<Set<string>>(new Set());
  readonly availableInspirationChips = computed(() => {
    const used = this.usedInspirationIds();
    return INSPIRATION_CHIPS.filter(c => !used.has(c.id));
  });

  ngOnInit(): void {
    // Load existing templates from the service signal (already fetched by parent)
    const existing = this.templatesService.templates();
    if (existing && existing.length > 0) {
      this.routines.set(
        existing.map(t => ({
          localId: crypto.randomUUID(),
          name: t.title,
          rrule: t.recurrence_rule ?? 'FREQ=DAILY',
          templateId: t.template_id,
        }))
      );
    }
  }

  selectWeekDay(byday: string): void {
    this.selectedWeekDay = byday;
  }

  /** Resolve the effective rrule for the current form state. */
  private effectiveRrule(): string {
    if (this.selectedRrule === 'FREQ=WEEKLY;BYDAY=') {
      return `FREQ=WEEKLY;BYDAY=${this.selectedWeekDay}`;
    }
    return this.selectedRrule;
  }

  addRoutine(): void {
    if (this.isAdding()) return;
    const name = this.routineName.trim();
    if (!name) return;

    const rrule = this.effectiveRrule();
    const recurrence = rruleToRecurrenceType(rrule);
    const req: CreateScheduleTemplateRequest = {
      task_type: 'custom',
      title: name,
      recurrence,
      recurrence_rule: rrule,
    };

    this.isAdding.set(true);
    this.addError.set('');
    this.templatesService.create(req).subscribe({
      next: (template: ScheduleTemplate) => {
        this.routines.update(list => [
          ...list,
          { localId: crypto.randomUUID(), name: template.title, rrule: template.recurrence_rule ?? rrule, templateId: template.template_id },
        ]);
        this.routineName = '';
        this.isAdding.set(false);
      },
      error: () => {
        this.addError.set('Failed to add routine. Please try again.');
        this.isAdding.set(false);
      },
    });
  }

  addInspirationChip(chip: InspirationChip): void {
    if (this.isAdding()) return;

    const req: CreateScheduleTemplateRequest = {
      task_type: 'custom',
      title: chip.name,
      recurrence: 'daily',
      recurrence_rule: chip.rrule,
    };

    this.isAdding.set(true);
    this.addError.set('');
    this.templatesService.create(req).subscribe({
      next: (template: ScheduleTemplate) => {
        this.usedInspirationIds.update(set => new Set([...set, chip.id]));
        this.routines.update(list => [
          ...list,
          { localId: crypto.randomUUID(), name: template.title, rrule: template.recurrence_rule ?? chip.rrule, templateId: template.template_id },
        ]);
        this.isAdding.set(false);
      },
      error: () => {
        this.addError.set('Failed to add routine. Please try again.');
        this.isAdding.set(false);
      },
    });
  }

  removeRoutine(localId: string): void {
    const routine = this.routines().find(r => r.localId === localId);
    if (!routine) return;

    // Remove from local list immediately
    this.routines.update(list => list.filter(r => r.localId !== localId));

    // Only call delete if the template has a server-assigned ID
    if (routine.templateId) {
      this.templatesService.delete(routine.templateId).subscribe();
    }
  }

  openEdit(routine: { localId: string; name: string; rrule: string; templateId: string | null }): void {
    const { selectedRrule, selectedWeekDay } = rruleToFormState(routine.rrule);
    this.editTitle = routine.name;
    this.editSelectedRrule = selectedRrule;
    this.editSelectedWeekDay = selectedWeekDay;
    this.saveError.set('');
    this.editingId.set(routine.localId);
  }

  cancelEdit(): void {
    this.saveError.set('');
    this.editingId.set(null);
  }

  saveEdit(routine: { localId: string; name: string; rrule: string; templateId: string | null }): void {
    if (!routine.templateId || this.isSaving()) return;
    const title = this.editTitle.trim();
    if (!title) return;

    const rrule = this.editEffectiveRrule();
    const recurrence = rruleToRecurrenceType(rrule);
    const req: UpdateScheduleTemplateRequest = { title, recurrence, recurrence_rule: rrule };

    this.isSaving.set(true);
    this.saveError.set('');
    this.templatesService.update(routine.templateId, req).subscribe({
      next: (updated: ScheduleTemplate) => {
        this.routines.update(list =>
          list.map(r => r.localId === routine.localId
            ? { ...r, name: updated.title, rrule: updated.recurrence_rule ?? rrule }
            : r)
        );
        this.editingId.set(null);
        this.isSaving.set(false);
      },
      error: () => {
        this.saveError.set('Failed to save. Please try again.');
        this.isSaving.set(false);
      },
    });
  }

  private editEffectiveRrule(): string {
    if (this.editSelectedRrule === 'FREQ=WEEKLY;BYDAY=') {
      return `FREQ=WEEKLY;BYDAY=${this.editSelectedWeekDay}`;
    }
    return this.editSelectedRrule;
  }

  addTask(): void {
    const name = this.taskName.trim();
    if (!name) return;
    this.taskNames.update(list => [...list, name]);
    this.taskName = '';
  }

  removeTask(index: number): void {
    this.taskNames.update(names => names.filter((_, i) => i !== index));
  }

  save(): void {
    const templates = this.templatesService.templates() ?? [];
    this.stateService.setScheduleTemplates(templates);
    this.stateService.setUpcomingTaskNames(this.taskNames());
    this.complete.emit();
  }
}
