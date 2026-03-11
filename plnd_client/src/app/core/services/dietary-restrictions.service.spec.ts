import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DietaryRestrictionsService } from './dietary-restrictions.service';
import { DietaryRestriction } from '../models/dietary-restriction';

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

describe('DietaryRestrictionsService', () => {
  let service: DietaryRestrictionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(DietaryRestrictionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('load() sets the signal with sorted items', () => {
    expect(service.restrictions()).toBeNull();

    service.load();

    const req = httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'GET');
    req.flush([MOCK_INTOLERANCE, MOCK_ALLERGY]);

    // Should be sorted: allergy < intolerance
    expect(service.restrictions()).toEqual([MOCK_ALLERGY, MOCK_INTOLERANCE]);
  });

  it('load() no-ops when already loaded', () => {
    service.load();
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'GET').flush([MOCK_ALLERGY]);

    service.load();
    httpMock.expectNone(r => r.url.endsWith('/dietary-restrictions'));

    expect(service.restrictions()).toEqual([MOCK_ALLERGY]);
  });

  it('create() posts and appends item to sorted array', () => {
    // Pre-seed signal with one item
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_INTOLERANCE]);

    const newItem: DietaryRestriction = { ...base, restriction_id: 'id-3', restriction_type: 'allergy', name: 'shellfish' };
    let result: DietaryRestriction | undefined;
    service.create({ restriction_type: 'allergy', name: 'shellfish' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST');
    req.flush(newItem);

    expect(result).toEqual(newItem);
    // allergy/peanuts would come before allergy/shellfish, but we only have shellfish + intolerance/lactose
    // sorted: allergy/shellfish < intolerance/lactose
    expect(service.restrictions()).toEqual([newItem, MOCK_INTOLERANCE]);
  });

  it('update() patches and replaces item in signal', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY, MOCK_INTOLERANCE]);

    const updated: DietaryRestriction = { ...MOCK_INTOLERANCE, notes: 'severe' };
    let result: DietaryRestriction | undefined;
    service.update('id-2', { notes: 'severe' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-2') && r.method === 'PATCH');
    req.flush(updated);

    expect(result).toEqual(updated);
    expect(service.restrictions()!.find(i => i.restriction_id === 'id-2')!.notes).toBe('severe');
  });

  it('delete() removes item from signal', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY, MOCK_INTOLERANCE]);

    service.delete('id-1').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions/id-1') && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(service.restrictions()!.length).toBe(1);
    expect(service.restrictions()![0].restriction_id).toBe('id-2');
  });

  it('clear() resets signal to null', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ALLERGY]);
    expect(service.restrictions()).not.toBeNull();

    service.clear();
    expect(service.restrictions()).toBeNull();
  });
});
