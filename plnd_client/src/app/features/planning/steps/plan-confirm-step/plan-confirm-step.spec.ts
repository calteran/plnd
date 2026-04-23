import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PlanConfirmStepComponent } from './plan-confirm-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanConfirmStepComponent', () => {
  let fixture: ComponentFixture<PlanConfirmStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanConfirmStepComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
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
    fixture.componentInstance.errorMessage = 'Failed to save plan — please try again.';
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.error-banner');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Failed to save plan');
  });
});
