import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { PlanConfirmStepComponent } from './plan-confirm-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { SKIP_SENTINEL } from '../../../../core/models/week-plan';

describe('PlanConfirmStepComponent', () => {
  let fixture: ComponentFixture<PlanConfirmStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanConfirmStepComponent, HttpClientTestingModule, RouterTestingModule]
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
    // No meals explicitly set — all pending slots are implicitly accepted
    fixture.detectChanges();
    expect(fixture.componentInstance.mealCoverage()).toBe(100);
  });

  it('should exclude __skipped__ slots from mealCoverage', () => {
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: SKIP_SENTINEL });
    fixture.detectChanges();
    // 7 days × 3 slots = 21 total; 1 skipped → 20 covered
    const expected = Math.round((20 / 21) * 100);
    expect(fixture.componentInstance.mealCoverage()).toBe(expected);
  });
});
