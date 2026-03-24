import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanTasksStepComponent } from './plan-tasks-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanTasksStepComponent', () => {
  let fixture: ComponentFixture<PlanTasksStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanTasksStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanTasksStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should render one row per horizon day', () => {
    const rows = fixture.nativeElement.querySelectorAll('.day-tasks-row');
    expect(rows.length).toBe(7);
  });

  it('should add task when form is submitted', () => {
    spyOn(service, 'addTask');
    const comp = fixture.componentInstance;
    comp.addTaskForm.setValue({ date: '2026-03-24', title: 'Walk', energy: 'low', duration: 30 });
    comp.submitAddTask();
    expect(service.addTask).toHaveBeenCalledWith(
      jasmine.objectContaining({ date: '2026-03-24', title: 'Walk', energy: 'low' })
    );
  });
});
