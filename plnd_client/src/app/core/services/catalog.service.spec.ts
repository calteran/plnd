import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { CatalogService, IngestIngredientResponse, IngredientSearchResponse, LocalIngredientResult } from './catalog.service';

describe('CatalogService', () => {
  let service: CatalogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CatalogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getIngredient() makes GET /catalog/ingredients/{id}', () => {
    const mockIngredient = { ingredient_id: 'abc', name: 'Oats' };
    let result: unknown;
    service.getIngredient('abc').subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/catalog/ingredients/abc') && r.method === 'GET');
    req.flush(mockIngredient);

    expect(result).toEqual(mockIngredient);
  });

  it('getDish() makes GET /catalog/dishes/{id}', () => {
    const mockDish = { dish_id: 'dish-1', name: 'Pasta' };
    let result: unknown;
    service.getDish('dish-1').subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/catalog/dishes/dish-1') && r.method === 'GET');
    req.flush(mockDish);

    expect(result).toEqual(mockDish);
  });

  it('getMeal() makes GET /catalog/meals/{id}', () => {
    const mockMeal = { meal_id: 'meal-1', name: 'Breakfast Bowl' };
    let result: unknown;
    service.getMeal('meal-1').subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/catalog/meals/meal-1') && r.method === 'GET');
    req.flush(mockMeal);

    expect(result).toEqual(mockMeal);
  });

  it('ingestIngredient() makes POST /catalog/ingredients/ingest', () => {
    const body = { external_source: 'usda_fdc', external_id: '123', name: 'Oats' };
    const mockResponse = { ingredient_id: 'uuid-123' };
    let result: IngestIngredientResponse | undefined;
    service.ingestIngredient(body).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/catalog/ingredients/ingest') && r.method === 'POST');
    expect(req.request.body).toEqual(body);
    req.flush(mockResponse);

    expect(result?.ingredient_id).toBe('uuid-123');
  });

  it('searchIngredients() makes GET /search/ingredients with q and limit params', () => {
    const mockLocal: LocalIngredientResult[] = [
      { ingredient_id: 'abc-123', name: 'Oats', description: null, allergens: ['gluten'], occasion_tags: [], external_source: null },
    ];
    const mockResponse: IngredientSearchResponse = { local: mockLocal, external: [], providers_queried: [], providers_from_cache: [] };
    let result: IngredientSearchResponse | undefined;
    service.searchIngredients('oats').subscribe(r => (result = r));

    const req = httpMock.expectOne(r =>
      r.url.endsWith('/search/ingredients') &&
      r.method === 'GET' &&
      r.params.get('q') === 'oats' &&
      r.params.get('limit') === '8'
    );
    req.flush(mockResponse);

    expect(result?.local.length).toBe(1);
    expect(result?.local[0].ingredient_id).toBe('abc-123');
    expect(result?.local[0].name).toBe('Oats');
  });

  it('searchIngredients() respects custom limit parameter', () => {
    service.searchIngredients('rice', 5).subscribe();

    const req = httpMock.expectOne(r =>
      r.url.endsWith('/search/ingredients') &&
      r.params.get('q') === 'rice' &&
      r.params.get('limit') === '5'
    );
    req.flush({ local: [], external: [], providers_queried: [], providers_from_cache: [] });
    expect(req.request.method).toBe('GET');
  });
});
