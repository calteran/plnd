import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  let service: CatalogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
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
    const mockResponse = { catalog_ingredient_id: 'uuid-123' };
    let result: { catalog_ingredient_id: string } | undefined;
    service.ingestIngredient(body).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/catalog/ingredients/ingest') && r.method === 'POST');
    expect(req.request.body).toEqual(body);
    req.flush(mockResponse);

    expect(result?.catalog_ingredient_id).toBe('uuid-123');
  });
});
