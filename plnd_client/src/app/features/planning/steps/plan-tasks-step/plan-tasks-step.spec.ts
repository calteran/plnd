import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PlanTasksStepComponent } from './plan-tasks-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { AddedEntry } from '../../../schedule/components/add-entry/add-entry';

describe('PlanTasksStepComponent', () => {
  let fixture: ComponentFixture<PlanTasksStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanTasksStepComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanTasksStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should render one accordion section per horizon day', () => {
    const sections = fixture.nativeElement.querySelectorAll('.day-accordion');
    expect(sections.length).toBe(7);
  });

  it('should default all sections to open for a 7-day horizon', () => {
    const open = fixture.nativeElement.querySelectorAll('.day-accordion.open');
    expect(open.length).toBe(7);
  });

  it('should collapse a section when its header is clicked', () => {
    const header: HTMLElement = fixture.nativeElement.querySelector('.day-accordion__header');
    header.click();
    fixture.detectChanges();
    const open = fixture.nativeElement.querySelectorAll('.day-accordion.open');
    expect(open.length).toBe(6);
  });

  it('should re-expand a section when its header is clicked again', () => {
    const header: HTMLElement = fixture.nativeElement.querySelector('.day-accordion__header');
    header.click();
    fixture.detectChanges();
    header.click();
    fixture.detectChanges();
    const open = fixture.nativeElement.querySelectorAll('.day-accordion.open');
    expect(open.length).toBe(7);
  });

  it('onTaskAdded should call weekPlanService.addTask with correct fields for exercise', () => {
    spyOn(service, 'addTask');
    const entry: AddedEntry = { label: 'Morning run', type: 'exercise', duration: 30 };
    fixture.componentInstance.onTaskAdded('2026-03-24', entry);
    expect(service.addTask).toHaveBeenCalledWith(jasmine.objectContaining({
      date: '2026-03-24',
      title: 'Morning run',
      task_type: 'exercise',
      duration: 30,
      energy: 'medium',
    }));
  });

  it('onTaskAdded should set task_type to custom for non-exercise entries', () => {
    spyOn(service, 'addTask');
    const entry: AddedEntry = { label: 'Call dentist', type: 'appointment' };
    fixture.componentInstance.onTaskAdded('2026-03-25', entry);
    expect(service.addTask).toHaveBeenCalledWith(jasmine.objectContaining({
      task_type: 'custom',
    }));
  });

  it('onFloatingTaskAdded should call weekPlanService.addFloatingTask', () => {
    spyOn(service, 'addFloatingTask');
    const entry: AddedEntry = { label: 'Buy groceries', type: 'task' };
    fixture.componentInstance.onFloatingTaskAdded(entry);
    expect(service.addFloatingTask).toHaveBeenCalledWith(jasmine.objectContaining({
      title: 'Buy groceries',
      energy: 'medium',
      task_type: 'custom',
    }));
  });

  it('onFloatingTaskAdded should set task_type to exercise for exercise entries', () => {
    spyOn(service, 'addFloatingTask');
    const entry: AddedEntry = { label: '30 min yoga', type: 'exercise', duration: 30 };
    fixture.componentInstance.onFloatingTaskAdded(entry);
    expect(service.addFloatingTask).toHaveBeenCalledWith(jasmine.objectContaining({
      task_type: 'exercise',
      duration: 30,
    }));
  });

  it('should render floating tasks inside the floating panel', () => {
    service.addFloatingTask({ title: 'Unscheduled errand', energy: 'low', task_type: 'custom' });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.floating-task-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Unscheduled errand');
  });

  it('should call weekPlanService.removeFloatingTask when floating remove button is clicked', () => {
    spyOn(service, 'removeFloatingTask');
    service.addFloatingTask({ title: 'Task to remove', energy: 'low', task_type: 'custom' });
    fixture.detectChanges();
    const btn: HTMLElement = fixture.nativeElement.querySelector('.floating-remove');
    btn.click();
    expect(service.removeFloatingTask).toHaveBeenCalledWith(0);
  });

  it('should render the floating panel with correct header text', () => {
    const panel: HTMLElement = fixture.nativeElement.querySelector('.floating-panel');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('FLOATING TASKS');
    expect(panel.textContent).toContain('agent will schedule these');
  });

  it('removeTask should remove the correct task by day-local index', () => {
    spyOn(service, 'removeTask');
    service.addTask({ date: '2026-03-24', title: 'First', energy: 'low', task_type: 'custom' });
    service.addTask({ date: '2026-03-24', title: 'Second', energy: 'high', task_type: 'custom' });
    fixture.detectChanges();
    // Remove the second task (day-local index 1); its global index is also 1.
    fixture.componentInstance.removeTask('2026-03-24', 1);
    expect(service.removeTask).toHaveBeenCalledWith(1);
  });

  it('removeTask should resolve global index when tasks from other days precede', () => {
    spyOn(service, 'removeTask');
    service.addTask({ date: '2026-03-24', title: 'Day1 Task', energy: 'low', task_type: 'custom' });
    service.addTask({ date: '2026-03-25', title: 'Day2 Task', energy: 'medium', task_type: 'custom' });
    fixture.detectChanges();
    // Remove the first (and only) task on day 2; its global index is 1.
    fixture.componentInstance.removeTask('2026-03-25', 0);
    expect(service.removeTask).toHaveBeenCalledWith(1);
  });
});
