import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { DietaryRestrictionsComponent } from './dietary-restrictions';
import { DietaryRestriction } from '../../../core/models/dietary-restriction';

const base: Omit<DietaryRestriction, 'restriction_id' | 'restriction_type' | 'name'> = {
  user_id: 'test-uuid',
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

const MOCK_ALLERGY: DietaryRestriction = {
  ...base,
  restriction_id: 'id-1',
  restriction_type: 'allergy',
  name: 'peanuts'
};

const MOCK_INTOLERANCE: DietaryRestriction = {
  ...base,
  restriction_id: 'id-2',
  restriction_type: 'intolerance',
  name: 'lactose',
  notes: 'mild'
};

describe('DietaryRestrictionsComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DietaryRestrictionsComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create and show loading state initially', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.loading-text')).toBeTruthy();

    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'GET').flush([]);
    fixture.detectChanges();
    expect(el.querySelector('.loading-text')).toBeNull();
  });

  it('should render restriction items when loaded', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY, MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const items = el.querySelectorAll('.restriction-item');
    expect(items.length).toBe(2);
    expect(el.textContent).toContain('peanuts');
    expect(el.textContent).toContain('lactose');
    expect(el.textContent).toContain('mild');
  });

  it('should show empty message when no restrictions', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.empty-text')).toBeTruthy();
  });

  it('should call create() when add form is submitted', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addForm.setValue({ restriction_type: 'allergy', name: 'shellfish', notes: null });
    fixture.detectChanges();

    // Verify the form is valid before calling save() directly — the button
    // selector approach was unreliable (contradictory attribute selector).
    expect(component.addForm.valid).toBeTrue();

    component.save();
    const newItem: DietaryRestriction = { ...base, restriction_id: 'id-3', restriction_type: 'allergy', name: 'shellfish' };
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST').flush(newItem);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Restriction added.');
  });

  it('should show inline edit form when Edit clicked', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.startEdit(MOCK_INTOLERANCE);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.edit-form')).toBeTruthy();
    expect((el.querySelector('.edit-textarea') as HTMLTextAreaElement)?.value).toBe('mild');
  });

  it('should call update() when saveEdit is called', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.startEdit(MOCK_INTOLERANCE);
    component.editNotesControl.setValue('very mild');
    fixture.detectChanges();

    component.saveEdit('id-2');
    const updated: DietaryRestriction = { ...MOCK_INTOLERANCE, notes: 'very mild' };
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-2') && r.method === 'PATCH').flush(updated);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Updated successfully.');
    expect(component.editingId).toBeNull();
  });

  it('should call delete() when Delete button is clicked', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.deleteRestriction('id-1');
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-1') && r.method === 'DELETE')
      .flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Restriction removed.');
  });

  it('cancelEdit() resets editingId and clears editNotesControl', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.startEdit(MOCK_INTOLERANCE);
    expect(component.editingId).toBe('id-2');

    component.cancelEdit();
    expect(component.editingId).toBeNull();
    expect(component.editNotesControl.value).toBeNull();
  });

  it('saveEdit() shows error on HTTP 500', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.startEdit(MOCK_INTOLERANCE);
    component.saveEdit('id-2');
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-2') && r.method === 'PATCH')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBeTruthy();
    expect(component.pending).toBeFalse();
  });

  it('saveEdit() no-ops when pending is true', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.startEdit(MOCK_INTOLERANCE);
    component.pending = true;
    component.saveEdit('id-2');
    httpMock.expectNone(r => r.url.endsWith('/dietary-restrictions/id-2') && r.method === 'PATCH');
    expect(component.pending).toBeTrue();
  });

  it('deleteRestriction() shows error on HTTP 500', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.deleteRestriction('id-1');
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-1') && r.method === 'DELETE')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBeTruthy();
    expect(component.pending).toBeFalse();
  });

  it('deleteRestriction() no-ops when pending is true', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.pending = true;
    component.deleteRestriction('id-1');
    httpMock.expectNone(r => r.url.endsWith('/dietary-restrictions/id-1') && r.method === 'DELETE');
    expect(component.pending).toBeTrue();
  });

  it('save() no-ops when form invalid (empty name)', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addForm.setValue({ restriction_type: 'allergy', name: '', notes: null });
    component.save();
    httpMock.expectNone(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST');
    expect(component.pending).toBeFalse();
  });

  it('save() shows generic error for non-409 failure', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addForm.setValue({ restriction_type: 'allergy', name: 'shellfish', notes: null });
    component.save();
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBe('Failed to add. Please try again.');
  });

  it('renders notes span for items with notes', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const notesEl = el.querySelector('.item-notes');
    expect(notesEl?.textContent?.trim()).toBe('mild');
  });

  it('only renders sections for types that have items', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    // Only one allergy item — intolerance and preference sections should not render
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const sections = el.querySelectorAll('.type-section');
    expect(sections.length).toBe(1);
  });

  it('save() shows 409 conflict error for duplicate restriction', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addForm.setValue({ restriction_type: 'allergy', name: 'peanuts', notes: null });
    component.save();
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST')
      .flush('Conflict', { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(component.errorMessage).toBe('A restriction with this type and name already exists.');
  });

  it('saveEdit() coerces blank notes to null when saving', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.startEdit(MOCK_INTOLERANCE);
    component.editNotesControl.setValue('   '); // blank — should be coerced to null
    component.saveEdit('id-2');

    const req = httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-2') && r.method === 'PATCH');
    expect(req.request.body).toEqual({ notes: null });
    req.flush({ ...MOCK_INTOLERANCE, notes: null });
    fixture.detectChanges();

    expect(component.successMessage).toBe('Updated successfully.');
  });

  it('goBack() navigates to /today', () => {
    const fixture = TestBed.createComponent(DietaryRestrictionsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush([]);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    fixture.componentInstance.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/today']);
  });
});
