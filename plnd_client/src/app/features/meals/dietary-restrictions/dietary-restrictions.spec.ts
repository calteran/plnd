import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
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
      imports: [DietaryRestrictionsComponent, HttpClientTestingModule, RouterTestingModule]
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
});
