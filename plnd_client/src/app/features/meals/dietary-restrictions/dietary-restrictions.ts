import { Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { DietaryRestrictionsService } from '../../../core/services/dietary-restrictions.service';
import {
  DietaryRestriction,
  RestrictionType,
  RESTRICTION_TYPES,
  RESTRICTION_LABELS,
} from '../../../core/models/dietary-restriction';

@Component({
  selector: 'app-dietary-restrictions',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="dr-page">
      <div class="dr-header">
        <button class="back-btn" (click)="goBack()">← Back</button>
        <h1>Dietary Restrictions</h1>
      </div>

      @if (dietaryRestrictionsService.restrictions() === null) {
        <p class="loading-text">Loading…</p>
      } @else {
        <!-- Grouped list -->
        <div class="restrictions-list">
          @for (type of restrictionTypes; track type) {
            @if (groupedRestrictions()[type]?.length) {
              <section class="type-section">
                <h2 class="type-heading">{{ restrictionLabels[type] }}</h2>
                @for (item of groupedRestrictions()[type]; track item.restriction_id) {
                  <div class="restriction-item">
                    @if (editingId === item.restriction_id) {
                      <!-- Inline edit form -->
                      <div class="edit-form">
                        <span class="item-name">{{ item.name }}</span>
                        <label class="edit-label" [for]="'edit-notes-' + item.restriction_id">Notes</label>
                        <textarea
                          [id]="'edit-notes-' + item.restriction_id"
                          class="edit-textarea"
                          [formControl]="editNotesControl"
                          maxlength="500"
                          rows="3"
                          placeholder="Optional notes…"
                        ></textarea>
                        <div class="edit-actions">
                          <button
                            type="button"
                            class="btn btn--secondary"
                            (click)="cancelEdit()"
                          >Cancel</button>
                          <button
                            type="button"
                            class="btn btn--primary"
                            [disabled]="pending"
                            (click)="saveEdit(item.restriction_id)"
                          >{{ pending ? 'Saving…' : 'Save' }}</button>
                        </div>
                      </div>
                    } @else {
                      <!-- Read view -->
                      <div class="item-content">
                        <span class="item-name">{{ item.name }}</span>
                        @if (item.notes) {
                          <span class="item-notes">{{ item.notes }}</span>
                        }
                      </div>
                      <div class="item-actions">
                        <button
                          type="button"
                          class="btn btn--secondary"
                          (click)="startEdit(item)"
                        >Edit</button>
                        <button
                          type="button"
                          class="btn btn--danger"
                          [disabled]="pending"
                          (click)="deleteRestriction(item.restriction_id)"
                        >Delete</button>
                      </div>
                    }
                  </div>
                }
              </section>
            }
          }

          @if (!hasAny()) {
            <p class="empty-text">No dietary restrictions added yet.</p>
          }
        </div>

        <!-- Status messages -->
        @if (successMessage) {
          <p class="status-success">{{ successMessage }}</p>
        }
        @if (errorMessage) {
          <p class="status-error">{{ errorMessage }}</p>
        }

        <!-- Add form -->
        <section class="add-section">
          <h2 class="type-heading">Add Restriction</h2>
          <form class="add-form" [formGroup]="addForm">
            <div class="form-field">
              <label for="restriction-type">Type</label>
              <select id="restriction-type" formControlName="restriction_type">
                <option value="allergy">Allergy</option>
                <option value="intolerance">Intolerance</option>
                <option value="preference">Preference</option>
                <option value="cultural_religious">Cultural / Religious</option>
              </select>
            </div>

            <div class="form-field">
              <label for="name">Name</label>
              <input
                id="name"
                type="text"
                formControlName="name"
                maxlength="100"
                placeholder="e.g. peanuts"
              />
            </div>

            <div class="form-field">
              <label for="notes">Notes (optional)</label>
              <textarea
                id="notes"
                formControlName="notes"
                maxlength="500"
                rows="3"
                placeholder="Optional notes…"
              ></textarea>
            </div>

            <div class="form-actions">
              <button
                type="button"
                class="btn btn--primary"
                [disabled]="pending || addForm.invalid"
                (click)="save()"
              >{{ pending ? 'Adding…' : 'Add Restriction' }}</button>
            </div>
          </form>
        </section>
      }
    </div>
  `,
  styles: [`
    .dr-page {
      max-width: 700px;
      margin: 0 auto;
      padding: 1.5rem;
    }

    .dr-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--color-accent);
      padding: 0.25rem 0.5rem;
    }

    .back-btn:hover { text-decoration: underline; }

    h1 { margin: 0; font-size: 1.5rem; }

    .loading-text,
    .empty-text { color: var(--color-text-muted); }

    .restrictions-list {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .type-section { display: flex; flex-direction: column; gap: 0.5rem; }

    .type-heading {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text-body);
      text-transform: capitalize;
      margin: 0 0 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid var(--color-btn-neutral-border);
    }

    .restriction-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      background: var(--color-surface-base);
      border: 1px solid var(--color-btn-neutral-border);
      border-radius: 8px;
    }

    .item-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;
    }

    .item-name {
      font-weight: 500;
      color: var(--color-text-body);
      font-size: 0.9375rem;
    }

    .item-notes {
      font-size: 0.8125rem;
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 400px;
    }

    .item-actions,
    .edit-actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .edit-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      flex: 1;
    }

    .edit-label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-body);
    }

    .edit-textarea {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border-input);
      border-radius: 6px;
      font-size: 0.875rem;
      resize: vertical;
      font-family: inherit;
    }

    .edit-textarea:focus {
      outline: none;
      border-color: var(--color-accent);
    }

    .status-success { color: var(--color-success); font-size: 0.875rem; margin: 0 0 1rem; }
    .status-error   { color: var(--color-destructive); font-size: 0.875rem; margin: 0 0 1rem; }

    .add-section { margin-top: 2rem; }

    .add-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-top: 1rem;
    }

    .form-field { display: flex; flex-direction: column; gap: 0.375rem; }

    label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-body);
    }

    input,
    select,
    textarea {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border-input);
      border-radius: 6px;
      font-size: 0.875rem;
      background: var(--color-surface-white);
      font-family: inherit;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: var(--color-accent);
    }

    textarea { resize: vertical; }

    .form-actions { display: flex; justify-content: flex-end; }

    .btn {
      padding: 0.4375rem 1rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s ease;
    }

    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn--primary { background: var(--color-accent); color: var(--color-btn-accent-text); }
    .btn--primary:hover:not(:disabled) { background: var(--color-accent-dark); }

    .btn--secondary {
      background: var(--color-btn-neutral-border);
      color: var(--color-text-body);
    }
    .btn--secondary:hover:not(:disabled) { background: color-mix(in srgb, var(--color-btn-neutral-border) 80%, var(--color-surface-base)); }

    .btn--danger { background: var(--color-destructive-light); color: var(--color-destructive); }
    .btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--color-destructive) 20%, var(--color-surface-white)); }
  `]
})
export class DietaryRestrictionsComponent implements OnInit {
  // Public so the template can read the restrictions() signal directly.
  // Mutating methods (create/delete/etc.) live on the service — keep this in
  // mind if this component is ever extended or composed.
  readonly dietaryRestrictionsService = inject(DietaryRestrictionsService);
  private readonly router = inject(Router);

  readonly restrictionTypes: RestrictionType[] = RESTRICTION_TYPES;
  readonly restrictionLabels = RESTRICTION_LABELS;

  readonly groupedRestrictions = computed<Record<RestrictionType, DietaryRestriction[]>>(() => {
    const items = this.dietaryRestrictionsService.restrictions() ?? [];
    return {
      allergy: items.filter(i => i.restriction_type === 'allergy'),
      intolerance: items.filter(i => i.restriction_type === 'intolerance'),
      preference: items.filter(i => i.restriction_type === 'preference'),
      cultural_religious: items.filter(i => i.restriction_type === 'cultural_religious'),
    };
  });

  readonly hasAny = computed(() => (this.dietaryRestrictionsService.restrictions()?.length ?? 0) > 0);

  pending = false;
  successMessage = '';
  errorMessage = '';

  editingId: string | null = null;
  readonly editNotesControl = new FormControl<string | null>(null);

  readonly addForm = new FormGroup({
    restriction_type: new FormControl<RestrictionType>('allergy', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    notes: new FormControl<string | null>(null)
  });

  ngOnInit(): void {
    this.dietaryRestrictionsService.load();
  }

  startEdit(item: DietaryRestriction): void {
    this.editingId = item.restriction_id;
    this.editNotesControl.setValue(item.notes);
    this.successMessage = '';
    this.errorMessage = '';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editNotesControl.setValue(null);
  }

  saveEdit(id: string): void {
    if (this.pending) return;
    this.pending = true;
    this.successMessage = '';
    this.errorMessage = '';

    // Coerce blank string → null so the backend PATCH receives an explicit null
    // (clears the notes field) rather than an empty string.
    const notes = this.editNotesControl.value?.trim() || null;
    this.dietaryRestrictionsService.update(id, { notes }).subscribe({
      next: () => {
        this.pending = false;
        this.editingId = null;
        this.editNotesControl.setValue(null);
        this.successMessage = 'Updated successfully.';
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to update. Please try again.';
      }
    });
  }

  deleteRestriction(id: string): void {
    if (this.pending) return;
    this.pending = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.dietaryRestrictionsService.delete(id).subscribe({
      next: () => {
        this.pending = false;
        this.successMessage = 'Restriction removed.';
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to delete. Please try again.';
      }
    });
  }

  save(): void {
    if (this.pending || this.addForm.invalid) return;

    this.pending = true;
    this.successMessage = '';
    this.errorMessage = '';

    const { restriction_type, name, notes } = this.addForm.getRawValue();
    // Omit notes entirely when blank (field is optional on create).
    // This is intentionally asymmetric with saveEdit(), which sends null to
    // explicitly clear an existing value via PATCH COALESCE logic.
    const req = {
      restriction_type,
      name,
      ...(notes?.trim() ? { notes: notes.trim() } : {})
    };

    this.dietaryRestrictionsService.create(req).subscribe({
      next: () => {
        this.pending = false;
        this.successMessage = 'Restriction added.';
        this.addForm.reset({ restriction_type: 'allergy', name: '', notes: null });
      },
      error: (err) => {
        this.pending = false;
        if (err.status === 409) {
          this.errorMessage = 'A restriction with this type and name already exists.';
        } else {
          this.errorMessage = 'Failed to add. Please try again.';
        }
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/today']);
  }
}
