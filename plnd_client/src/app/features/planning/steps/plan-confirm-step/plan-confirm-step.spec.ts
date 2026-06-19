import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { PlanConfirmStepComponent } from './plan-confirm-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { MealPatternEntry } from '../../../../core/models/meal-pattern';

const PATTERN_FIXTURE: MealPatternEntry[] = [
  { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
  { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
  { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
];

describe('PlanConfirmStepComponent', () => {
  let fixture: ComponentFixture<PlanConfirmStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanConfirmStepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: DayTypesMealsService,
          useValue: {
            load: jasmine.createSpy('load'),
            allEntries: signal<MealPatternEntry[]>(PATTERN_FIXTURE).asReadonly(),
            loaded: signal(true).asReadonly(),
            mealsForDate: jasmine.createSpy('mealsForDate').and.callFake(() => PATTERN_FIXTURE),
            clear: jasmine.createSpy('clear'),
          },
        },
      ],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanConfirmStepComponent);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should show Finish Week Plan button', () => {
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    expect(btn).toBeTruthy();
  });

  it('should show summary stats', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('7'); // 7 days planned
  });

  it('should call commitPlan on finish click', () => {
    spyOn(service, 'commitPlan').and.returnValue(
      of({ committed: 0, planning_task_status: 'completed' })
    );
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    btn.click();
    expect(service.commitPlan).toHaveBeenCalled();
  });

  it('should count pending slots (no entry) as fully covered', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.mealCoverage()).toBe(100);
  });

  it('should exclude __skipped__ slots from mealCoverage', () => {
    service.setMeal('2026-03-24', 'breakfast', { approvalState: 'skipped', mealRef: null, title: '' });
    fixture.detectChanges();
    // 7 days × 3 slots = 21 total; 1 skipped → 20 covered
    const expected = Math.round((20 / 21) * 100);
    expect(fixture.componentInstance.mealCoverage()).toBe(expected);
  });

  // ── New structure tests ───────────────────────────────────────────────────

  it('should render a completion banner container', () => {
    const banner = fixture.nativeElement.querySelector('.completion-banner');
    expect(banner).toBeTruthy();
  });

  it('should show "Ready to go!" heading inside the banner', () => {
    const heading = fixture.nativeElement.querySelector('.banner-heading');
    expect(heading?.textContent?.trim()).toBe('Ready to go!');
  });

  it('should render the step title', () => {
    const title = fixture.nativeElement.querySelector('.step-title');
    expect(title?.textContent?.trim()).toBe('Confirm Your Plan');
  });

  it('should render the week range in the subtitle', () => {
    const sub = fixture.nativeElement.querySelector('.step-sub');
    // initSession sets 2026-03-24 → 2026-03-30
    expect(sub?.textContent).toContain('Mar 24');
    expect(sub?.textContent).toContain('Mar 30');
  });

  it('should not show error banner when there is no error', () => {
    const el = fixture.nativeElement.querySelector('.error-banner');
    expect(el).toBeNull();
  });

  it('should show styled error banner when errorMessage is set', () => {
    fixture.componentInstance.errorMessage.set('Failed to save plan — please try again.');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.error-banner');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Failed to save plan');
  });

  it('should accumulate totalSlots per day when day types have different slot counts', () => {
    const dtSvc = TestBed.inject(DayTypesMealsService) as unknown as { mealsForDate: jasmine.Spy };
    // Mon–Fri get 3 slots; Sat/Sun get only 1 slot (dinner)
    dtSvc.mealsForDate.and.callFake((date: string) => {
      const dow = new Date(`${date}T12:00:00`).getDay();
      return (dow === 0 || dow === 6) ? [PATTERN_FIXTURE[2]] : PATTERN_FIXTURE;
    });
    fixture.detectChanges();
    // 2026-03-24..30: Mon-Fri = 5 days × 3 slots = 15; Sat+Sun = 2 days × 1 slot = 2 → total 17
    // None skipped → 100%
    expect(fixture.componentInstance.mealCoverage()).toBe(100);

    // Now skip one weekday dinner — covered = 16/17
    service.setMeal('2026-03-24', 'dinner', { approvalState: 'skipped', mealRef: null, title: '' });
    fixture.detectChanges();
    expect(fixture.componentInstance.mealCoverage()).toBe(Math.round((16 / 17) * 100));
  });
});
