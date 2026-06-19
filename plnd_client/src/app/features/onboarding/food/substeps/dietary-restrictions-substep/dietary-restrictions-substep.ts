import { Component, EventEmitter, OnInit, Output, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { RestrictionType } from '../../../../../core/models/dietary-restriction';

type DisplayRestrictionType = 'allergy' | 'intolerance' | 'cultural_religious';

const TYPE_CONFIG: Record<DisplayRestrictionType, { label: string }> = {
  allergy:            { label: 'Allergy' },
  intolerance:        { label: 'Intolerance' },
  cultural_religious: { label: 'Cultural / Religious' },
};

@Component({
  selector: 'app-dietary-restrictions-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="restrictions-substep">
      <div class="banner">These foods <strong>should never appear</strong> in your meal plan.</div>

      <div class="entry-area">
        <div class="type-row">
          @for (dt of displayTypes; track dt) {
            <button type="button" class="type-btn"
              [class.type-btn--allergy]="dt === 'allergy'"
              [class.type-btn--intolerance]="dt === 'intolerance'"
              [class.type-btn--cultural_religious]="dt === 'cultural_religious'"
              [class.type-btn--active]="selectedDisplayType() === dt"
              (click)="selectedDisplayType.set(dt)"
            >{{ typeConfig[dt].label }}</button>
          }
        </div>
        <div class="name-row">
          <input class="name-input" type="text" placeholder="Name"
            [value]="newName()" (input)="newName.set(asText($event))" />
          <button class="btn-add-note" type="button" (click)="showNote.set(!showNote())">
            {{ showNote() ? '− Remove note' : '+ Add a note' }}
          </button>
          <button class="btn-add" type="button" (click)="add()">Add</button>
        </div>
        @if (showNote()) {
          <textarea class="note-input" placeholder="Optional note"
            [value]="newNote()" (input)="newNote.set(asText($event))"></textarea>
        }
        @if (addError()) {
          <p class="error">Failed to add restriction — please try again.</p>
        }
      </div>

      <div class="cards">
        @for (r of restrictionsService.restrictions(); track r.restriction_id) {
          <div class="restriction-card"
            [style.opacity]="editingId() && editingId() !== r.restriction_id ? '0.45' : '1'"
          >
            @if (editingId() === r.restriction_id) {
              <div class="card-edit">
                <p class="edit-name-readonly">{{ editName() }}</p>
                <textarea class="note-input" [value]="editNote()"
                  (input)="editNote.set(asText($event))" placeholder="Optional note"></textarea>
                <div class="edit-actions">
                  <button type="button" class="btn-cancel" (click)="cancelEdit()">Cancel</button>
                  <button type="button" class="btn-save" (click)="saveEdit(r.restriction_id)">Save</button>
                </div>
              </div>
            } @else {
              <div class="card-default" (click)="startEdit(r)">
                <span class="type-badge"
                  [class.type-badge--allergy]="displayTypeFor(r.restriction_type) === 'allergy'"
                  [class.type-badge--intolerance]="displayTypeFor(r.restriction_type) === 'intolerance'"
                  [class.type-badge--cultural_religious]="displayTypeFor(r.restriction_type) === 'cultural_religious'"
                >{{ typeConfig[displayTypeFor(r.restriction_type)].label }}</span>
                <span class="card-name">{{ r.name }}</span>
                @if (r.notes) { <span class="card-notes">{{ r.notes }}</span> }
              </div>
              <button type="button" class="btn-remove" (click)="$event.stopPropagation(); remove(r.restriction_id)">✕</button>
            }
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .restrictions-substep { display: flex; flex-direction: column; gap: 16px; }
    .banner { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--color-accent-dark); }
    .entry-area { display: flex; flex-direction: column; gap: 8px; }
    .type-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .type-btn { border: 1.5px solid var(--color-border-input); background: var(--color-surface-white); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: var(--color-btn-neutral-text); }
    .type-btn--allergy { border-color: var(--color-destructive-border); }
    .type-btn--intolerance { border-color: var(--color-accent-border); }
    .type-btn--cultural_religious { border-color: var(--color-purple-border); }
    .type-btn--active { font-weight: 700; color: var(--color-text-body); }
    .name-row { display: flex; gap: 8px; align-items: center; }
    .name-input { flex: 1; border: 1.5px solid var(--color-border-input); border-radius: 6px; padding: 7px 10px; font-size: 13px; }
    .btn-add-note { background: none; border: none; color: var(--color-accent); font-size: 12px; cursor: pointer; }
    .btn-add { background: var(--color-accent); color: var(--color-btn-accent-text); border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .note-input { width: 100%; border: 1.5px solid var(--color-border-input); border-radius: 6px; padding: 7px 10px; font-size: 13px; resize: vertical; box-sizing: border-box; }
    .error { color: var(--color-destructive); font-size: 12px; margin: 0; }
    .cards { display: flex; flex-direction: column; gap: 8px; }
    .restriction-card { position: relative; border: 1.5px solid var(--color-btn-neutral-border); border-radius: 8px; overflow: hidden; transition: opacity 0.15s; }
    .card-default { padding: 10px 40px 10px 12px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
    .card-default:hover { background: var(--color-surface-base); }
    .type-badge { font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 6px; align-self: flex-start; }
    .type-badge--allergy { color: var(--color-destructive); background: var(--color-destructive-light); }
    .type-badge--intolerance { color: var(--color-accent-dark); background: var(--color-accent-light); }
    .type-badge--cultural_religious { color: var(--color-purple); background: var(--color-purple-light); }
    .card-name { font-size: 13px; font-weight: 500; color: var(--color-text-body); }
    .card-notes { font-size: 12px; color: var(--color-text-muted); }
    .btn-remove { position: absolute; top: 8px; right: 8px; background: none; border: none; font-size: 13px; color: var(--color-text-muted); cursor: pointer; line-height: 1; }
    .btn-remove:hover { color: var(--color-destructive); }
    .card-edit { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .edit-name-readonly { font-size: 13px; font-weight: 600; color: var(--color-text-body); margin: 0; }
    .edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .btn-cancel { background: none; border: 1.5px solid var(--color-border-input); border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
    .btn-save { background: var(--color-accent); color: var(--color-btn-accent-text); border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
  `],
})
export class DietaryRestrictionsSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  protected readonly restrictionsService = inject(DietaryRestrictionsService);

  readonly selectedDisplayType = signal<DisplayRestrictionType>('allergy');
  readonly newName = signal('');
  readonly newNote = signal('');
  readonly showNote = signal(false);
  readonly addError = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  readonly editNote = signal('');

  readonly displayTypes: DisplayRestrictionType[] = ['allergy', 'intolerance', 'cultural_religious'];
  readonly typeConfig = TYPE_CONFIG;

  ngOnInit(): void {
    this.restrictionsService.load();
  }

  protected asText(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  displayTypeFor(apiType: RestrictionType): DisplayRestrictionType {
    if (apiType === 'allergy') return 'allergy';
    if (apiType === 'intolerance') return 'intolerance';
    return 'cultural_religious'; // covers 'cultural_religious' and legacy 'preference' data
  }

  add(): void {
    const name = this.newName().trim();
    if (!name) return;
    this.addError.set(false);
    this.restrictionsService
      .create({
        restriction_type: this.selectedDisplayType(),
        name,
        ...(this.newNote().trim() ? { notes: this.newNote().trim() } : {}),
      })
      .subscribe({
        next: () => { this.newName.set(''); this.newNote.set(''); this.showNote.set(false); },
        error: () => this.addError.set(true),
      });
  }

  startEdit(r: { restriction_id: string; restriction_type: RestrictionType; name: string; notes: string | null }): void {
    this.editingId.set(r.restriction_id);
    this.editName.set(r.name);
    this.editNote.set(r.notes ?? '');
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(id: string): void {
    this.restrictionsService
      .update(id, { notes: this.editNote().trim() || null })
      .subscribe({ next: () => this.editingId.set(null) });
  }

  remove(id: string): void {
    this.restrictionsService.delete(id).subscribe();
  }

  save(): void {
    this.complete.emit();
  }
}
