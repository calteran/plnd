import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { RestrictionType } from '../../../../../core/models/dietary-restriction';

// Display-only union — 'cultural_religious' maps to 'preference' for the API.
// Backend migration to add 'cultural_religious' to DB constraint is tracked in
// https://github.com/calteran/plnd/issues/559
type DisplayRestrictionType = 'allergy' | 'intolerance' | 'cultural_religious';

const API_TYPE_MAP: Record<DisplayRestrictionType, RestrictionType> = {
  allergy: 'allergy',
  intolerance: 'intolerance',
  cultural_religious: 'preference',
};

const TYPE_CONFIG: Record<DisplayRestrictionType, { label: string; borderColor: string; badgeColor: string; badgeBg: string }> = {
  allergy:            { label: 'Allergy',             borderColor: '#fca5a5', badgeColor: '#dc2626', badgeBg: '#fee2e2' },
  intolerance:        { label: 'Intolerance',          borderColor: '#fde68a', badgeColor: '#b45309', badgeBg: '#fef3c7' },
  cultural_religious: { label: 'Cultural / Religious', borderColor: '#c4b5fd', badgeColor: '#7c3aed', badgeBg: '#ede9fe' },
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
              [class.type-btn--active]="selectedDisplayType() === dt"
              [style.border-color]="typeConfig[dt].borderColor"
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
                  [style.color]="typeConfig[displayTypeFor(r.restriction_type)].badgeColor"
                  [style.background]="typeConfig[displayTypeFor(r.restriction_type)].badgeBg"
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
  styles: [`
    .restrictions-substep { display: flex; flex-direction: column; gap: 16px; }
    .banner { background: var(--color-accent-light,#fef3c7); border: 1.5px solid var(--color-accent-border,#fde68a); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--color-accent-dark,#78350f); }
    .entry-area { display: flex; flex-direction: column; gap: 8px; }
    .type-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .type-btn { border: 1.5px solid #d1d5db; background: #fff; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #6b7280; }
    .type-btn--active { font-weight: 700; color: #1f2937; }
    .name-row { display: flex; gap: 8px; align-items: center; }
    .name-input { flex: 1; border: 1.5px solid #d1d5db; border-radius: 6px; padding: 7px 10px; font-size: 13px; }
    .btn-add-note { background: none; border: none; color: var(--color-accent,#d97706); font-size: 12px; cursor: pointer; }
    .btn-add { background: var(--color-accent,#d97706); color: #fff; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .note-input { width: 100%; border: 1.5px solid #d1d5db; border-radius: 6px; padding: 7px 10px; font-size: 13px; resize: vertical; box-sizing: border-box; }
    .error { color: #dc2626; font-size: 12px; margin: 0; }
    .cards { display: flex; flex-direction: column; gap: 8px; }
    .restriction-card { position: relative; border: 1.5px solid #e5e7eb; border-radius: 8px; overflow: hidden; transition: opacity 0.15s; }
    .card-default { padding: 10px 40px 10px 12px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
    .card-default:hover { background: #f9fafb; }
    .type-badge { font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 6px; align-self: flex-start; }
    .card-name { font-size: 13px; font-weight: 500; color: #1f2937; }
    .card-notes { font-size: 12px; color: #6b7280; }
    .btn-remove { position: absolute; top: 8px; right: 8px; background: none; border: none; font-size: 13px; color: #9ca3af; cursor: pointer; line-height: 1; }
    .btn-remove:hover { color: #dc2626; }
    .card-edit { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .edit-name-readonly { font-size: 13px; font-weight: 600; color: #1f2937; margin: 0; }
    .edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .btn-cancel { background: none; border: 1.5px solid #d1d5db; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
    .btn-save { background: var(--color-accent,#d97706); color: #fff; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
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
    // No way to distinguish 'preference' saved as cultural_religious vs plain preference;
    // display all 'preference' items under cultural_religious as the closest match.
    return apiType === 'allergy' ? 'allergy'
         : apiType === 'intolerance' ? 'intolerance'
         : 'cultural_religious';
  }

  add(): void {
    const name = this.newName().trim();
    if (!name) return;
    this.addError.set(false);
    this.restrictionsService
      .create({
        restriction_type: API_TYPE_MAP[this.selectedDisplayType()],
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
