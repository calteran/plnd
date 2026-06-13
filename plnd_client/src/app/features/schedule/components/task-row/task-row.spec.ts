import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TaskRowComponent } from './task-row';
import { ScheduleTask } from '../../../../core/models/schedule';

const pending: ScheduleTask = { id: '1', type: 'general', label: '✉️ Email dentist', status: 'pending', oneShot: false };
const done:    ScheduleTask = { id: '2', type: 'general', label: '💊 Vitamins',      status: 'done',    oneShot: false };
const timed:   ScheduleTask = { id: '3', type: 'appointment', label: '📅 Standup', status: 'pending', scheduledTime: '11 AM', oneShot: false };

const workTask:  ScheduleTask = { id: '10', type: 'work',        label: 'Write report',  status: 'pending', oneShot: false };
const leiTask:   ScheduleTask = { id: '11', type: 'leisure',     label: 'Read novel',    status: 'pending', oneShot: false };
const medTask:   ScheduleTask = { id: '12', type: 'medication',  label: 'Vitamins',      status: 'pending', oneShot: false };
const genTask:   ScheduleTask = { id: '13', type: 'general',     label: 'Tidy desk',     status: 'pending', oneShot: false };
const exTask:    ScheduleTask = { id: '14', type: 'exercise',    label: 'Morning run',   status: 'pending', oneShot: false };
const apptTask:  ScheduleTask = { id: '15', type: 'appointment', label: 'Dentist',       status: 'pending', oneShot: false };

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

  it('shows Work badge for work type', async () => {
    const f = await setup(workTask);
    const badge = f.debugElement.query(By.css('.type-badge'));
    expect(badge).toBeTruthy();
    expect(badge.nativeElement.classList).toContain('type-badge--work');
    expect(badge.nativeElement.textContent.trim()).toBe('work');
  });

  it('shows Leisure badge for leisure type', async () => {
    const f = await setup(leiTask);
    const badge = f.debugElement.query(By.css('.type-badge'));
    expect(badge).toBeTruthy();
    expect(badge.nativeElement.classList).toContain('type-badge--leisure');
    expect(badge.nativeElement.textContent.trim()).toBe('leisure');
  });

  it('shows Rx badge for medication type', async () => {
    const f = await setup(medTask);
    const badge = f.debugElement.query(By.css('.type-badge'));
    expect(badge).toBeTruthy();
    expect(badge.nativeElement.classList).toContain('type-badge--medication');
    expect(badge.nativeElement.textContent.trim()).toBe('rx');
  });

  it('shows no badge for general type', async () => {
    const f = await setup(genTask);
    expect(f.debugElement.query(By.css('.type-badge'))).toBeNull();
  });

  it('shows Exercise badge for exercise type', async () => {
    const f = await setup(exTask);
    const badge = f.debugElement.query(By.css('.type-badge'));
    expect(badge).toBeTruthy();
    expect(badge.nativeElement.classList).toContain('type-badge--exercise');
    expect(badge.nativeElement.textContent.trim()).toBe('exercise');
  });

  it('shows Appt badge for appointment type', async () => {
    const f = await setup(apptTask);
    const badge = f.debugElement.query(By.css('.type-badge'));
    expect(badge).toBeTruthy();
    expect(badge.nativeElement.classList).toContain('type-badge--appointment');
    expect(badge.nativeElement.textContent.trim()).toBe('appt');
  });

  // One-shot is surfaced as a read-only indicator in the day view: it appears only on
  // tasks that are already one-shot, and toggling moves to a future task edit view.
  const oneShotTask: ScheduleTask = { id: 'os1', type: 'medication', label: 'Vitamins', status: 'pending', oneShot: true };

  it('renders no one-shot indicator for ordinary (carry-over) tasks', async () => {
    const f = await setup(pending);
    expect(f.debugElement.query(By.css('.one-shot-indicator'))).toBeNull();
  });

  it('renders a read-only one-shot indicator (not a button) for one-shot tasks', async () => {
    const f = await setup(oneShotTask);
    const indicator = f.debugElement.query(By.css('.one-shot-indicator'));
    expect(indicator).toBeTruthy();
    expect(indicator.nativeElement.tagName).not.toBe('BUTTON');
    expect(indicator.query(By.css('svg'))).toBeTruthy();
    expect(indicator.nativeElement.textContent).not.toContain('⤓');
  });

  it('makes the indicator keyboard-focusable so the label can be revealed on focus', async () => {
    const f = await setup(oneShotTask);
    const indicator = f.debugElement.query(By.css('.one-shot-indicator')).nativeElement;
    expect(indicator.getAttribute('tabindex')).toBe('0');
  });

  it('shows the plain-language "skip if missed" label on the indicator', async () => {
    const f = await setup(oneShotTask);
    const label = f.debugElement.query(By.css('.one-shot-label'));
    expect(label).toBeTruthy();
    expect(label.nativeElement.textContent.trim()).toBe('skip if missed');
  });

  it('exposes an accessible label naming the task, without the misleading "one-time" wording', async () => {
    const f = await setup(oneShotTask);
    const indicator = f.debugElement.query(By.css('.one-shot-indicator')).nativeElement;
    const aria = indicator.getAttribute('aria-label');
    expect(indicator.getAttribute('role')).toBe('img');
    expect(aria).toContain('Vitamins');
    expect(aria.toLowerCase()).toContain('skip if missed');
    expect(aria.toLowerCase()).toContain('carry over');
    expect(aria.toLowerCase()).not.toContain('one-time');
  });
});
