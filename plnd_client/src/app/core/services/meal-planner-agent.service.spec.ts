import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MealPlannerAgentService } from './meal-planner-agent.service';
import { MealPlanState } from '../models/week-plan';

const MOCK_STATE: MealPlanState = {
  week_start: '2026-03-24',
  meals: [
    { date: '2026-03-24', meal_name: 'breakfast', approved: false, skipped: false },
    { date: '2026-03-24', meal_name: 'lunch',     approved: false, skipped: false },
    { date: '2026-03-24', meal_name: 'dinner',    approved: false, skipped: false },
  ],
};

describe('MealPlannerAgentService', () => {
  let svc: MealPlannerAgentService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    svc      = TestBed.inject(MealPlannerAgentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('generateWeek posts to /agent/meal-plan with correct body', () => {
    let result: unknown;
    svc.generateWeek('2026-03-24', MOCK_STATE).subscribe(r => { result = r; });

    const req = httpMock.expectOne(r => r.url.endsWith('/agent/meal-plan') && r.method === 'POST');
    expect(req.request.body).toEqual({ week_start: '2026-03-24', current_state: MOCK_STATE });
    const mockResp = { week: '2026-03-24', meals: [] };
    req.flush(mockResp);
    expect(result).toEqual(mockResp);
  });

  it('rebalance posts to /agent/meal-plan/rebalance with correct body', () => {
    let result: unknown;
    svc.rebalance('2026-03-24', MOCK_STATE).subscribe(r => { result = r; });

    const req = httpMock.expectOne(r => r.url.endsWith('/agent/meal-plan/rebalance') && r.method === 'POST');
    expect(req.request.body).toEqual({ week_start: '2026-03-24', current_state: MOCK_STATE });
    req.flush({ week: '2026-03-24', meals: [] });
    expect(result).toBeTruthy();
  });

  it('suggestSlot posts to /agent/meal-plan/suggest with correct body', () => {
    let result: unknown;
    svc.suggestSlot('2026-03-24', 'lunch').subscribe(r => { result = r; });

    const req = httpMock.expectOne(r => r.url.endsWith('/agent/meal-plan/suggest') && r.method === 'POST');
    expect(req.request.body).toEqual({ date: '2026-03-24', meal_name: 'lunch' });
    const mockEntry = { date: '2026-03-24', meal_name: 'lunch', meal_ref: null };
    req.flush(mockEntry);
    expect(result).toEqual(mockEntry);
  });

  it('suggestSlot includes context.avoid_meal_refs when avoid list is non-empty', () => {
    svc.suggestSlot('2026-03-24', 'dinner', [{ type: 'user', id: 'u1' }]).subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/agent/meal-plan/suggest') && r.method === 'POST');
    expect(req.request.body.context).toEqual({ avoid_meal_refs: [{ type: 'user', id: 'u1' }] });
    req.flush({ date: '2026-03-24', meal_name: 'dinner', meal_ref: null });
  });

  it('resolveText posts to /agent/meal-plan/resolve with correct body', () => {
    let result: unknown;
    svc.resolveText('Egg toast', 'breakfast', '2026-03-24').subscribe(r => { result = r; });

    const req = httpMock.expectOne(r => r.url.endsWith('/agent/meal-plan/resolve') && r.method === 'POST');
    expect(req.request.body).toEqual({ text: 'Egg toast', meal_name: 'breakfast', date: '2026-03-24' });
    const mockResp = { meal_ref: null, confirmation: 'Added Egg toast' };
    req.flush(mockResp);
    expect(result).toEqual(mockResp);
  });

  it('resolveText omits date field when not provided', () => {
    svc.resolveText('Scrambled eggs', 'breakfast').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/agent/meal-plan/resolve') && r.method === 'POST');
    expect(req.request.body).toEqual({ text: 'Scrambled eggs', meal_name: 'breakfast' });
    req.flush({ meal_ref: null, confirmation: 'Added' });
  });
});
