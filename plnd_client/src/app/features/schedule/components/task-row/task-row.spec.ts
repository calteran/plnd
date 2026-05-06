import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TaskRowComponent } from './task-row';
import { ScheduleTask } from '../../../../core/models/schedule';

const pending: ScheduleTask = { id: '1', type: 'general', label: '✉️ Email dentist', status: 'pending' };
const done:    ScheduleTask = { id: '2', type: 'general', label: '💊 Vitamins',      status: 'done'    };
const timed:   ScheduleTask = { id: '3', type: 'appointment', label: '📅 Standup', status: 'pending', scheduledTime: '11 AM' };

describe('TaskRowComponent', () => {
  async function setup(item: ScheduleTask) {
    await TestBed.configureTestingModule({ imports: [TaskRowComponent] }).compileComponents();
    const f = TestBed.createComponent(TaskRowComponent);
    f.componentRef.setInput('item', item);
    f.detectChanges();
    return f;
  }

  it('renders the item label', async () => {
    const f = await setup(pending);
    expect(f.nativeElement.textContent).toContain('Email dentist');
  });

  it('shows time in gutter for timed items', async () => {
    const f = await setup(timed);
    expect(f.nativeElement.textContent).toContain('11 AM');
  });

  it('does not show time for untimed items', async () => {
    const f = await setup(pending);
    const gutter = f.debugElement.query(By.css('.gutter'));
    expect(gutter.nativeElement.textContent.trim()).toBe('');
  });

  it('emits toggle with item id when checkbox clicked', async () => {
    const f = await setup(pending);
    let emitted: string | undefined;
    f.componentInstance.toggled.subscribe((id: string) => emitted = id);
    f.debugElement.query(By.css('.checkbox')).nativeElement.click();
    expect(emitted).toBe('1');
  });

  it('applies struck class to label when done', async () => {
    const f = await setup(done);
    expect(f.debugElement.query(By.css('.label.struck'))).toBeTruthy();
  });

  it('checkbox has aria-label describing the action', async () => {
    const f = await setup(pending);
    const cb = f.debugElement.query(By.css('.checkbox'));
    expect(cb.nativeElement.getAttribute('aria-label')).toContain('Email dentist');
  });
});
