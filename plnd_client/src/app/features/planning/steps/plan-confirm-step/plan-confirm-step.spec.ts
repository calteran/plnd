import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { PlanConfirmStepComponent } from './plan-confirm-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

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
    fixture.componentInstance.planningTaskId = 'task-uuid';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    btn.click();
    expect(service.commitPlan).toHaveBeenCalled();
  });
});
