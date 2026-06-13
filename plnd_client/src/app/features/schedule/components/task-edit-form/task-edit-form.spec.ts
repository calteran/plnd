import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskEditFormComponent } from './task-edit-form';
import { ScheduleTask } from '../../../../core/models/schedule';

function task(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 't1', type: 'general', label: 'Call dentist', status: 'pending',
           oneShot: false, floating: false, scheduledStart: '11:00',
           durationMinutes: 30, energy: 'low', ...overrides };
}

describe('TaskEditFormComponent', () => {
  let fixture: ComponentFixture<TaskEditFormComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TaskEditFormComponent] }).compileComponents();
    fixture = TestBed.createComponent(TaskEditFormComponent);
  });

  it('emits a save patch with only the changed field on title blur', () => {
    fixture.componentRef.setInput('task', task());
    fixture.detectChanges();
    const saves: unknown[] = [];
    fixture.componentInstance.save.subscribe(p => saves.push(p));

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="title"]');
    input.value = 'Call orthodontist';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));

    expect(saves).toEqual([{ title: 'Call orthodontist' }]);
  });

  it('blocks a blank title (no save emitted)', () => {
    fixture.componentRef.setInput('task', task());
    fixture.detectChanges();
    const saves: unknown[] = [];
    fixture.componentInstance.save.subscribe(p => saves.push(p));

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="title"]');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));

    expect(saves).toEqual([]);
  });

  it('disables the time field for a floating task', () => {
    fixture.componentRef.setInput('task', task({ floating: true, scheduledStart: undefined }));
    fixture.detectChanges();
    const time: HTMLInputElement = fixture.nativeElement.querySelector('input[name="time"]');
    expect(time.disabled).toBeTrue();
  });

  it('one-shot toggle has switch semantics and a state-dependent label', () => {
    fixture.componentRef.setInput('task', task());
    fixture.detectChanges();
    const toggle: HTMLElement = fixture.nativeElement.querySelector('[role="switch"]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-label')?.toLowerCase()).toContain('skip if missed');
  });
});
