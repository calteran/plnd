import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { RoutinesTasksSubstepComponent } from './routines-tasks-substep';
import { ScheduleTemplatesService } from '../../../../../core/services/schedule-templates.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { ScheduleTemplate } from '../../../../../core/models/schedule-template';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    template_id: 'tmpl-1',
    user_id: 'user-1',
    task_type: 'custom',
    title: 'Morning walk',
    recurrence: 'daily',
    recurrence_rule: 'FREQ=DAILY',
    time_window_start: null,
    time_window_end: null,
    duration_minutes: null,
    energy_required: 'medium',
    is_milepost: false,
    task_ref_id: null,
    task_ref_type: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTemplatesSvcMock(initialTemplates: ScheduleTemplate[] = []) {
  const templatesSignal: WritableSignal<ScheduleTemplate[] | null> = signal(initialTemplates);
  const mock = jasmine.createSpyObj<ScheduleTemplatesService>(
    'ScheduleTemplatesService',
    ['load', 'create', 'delete', 'clear'],
    { templates: templatesSignal.asReadonly() }
  );
  return { mock, templatesSignal };
}

function makeStateMock() {
  return {
    setScheduleTemplates: jasmine.createSpy('setScheduleTemplates'),
    setUpcomingTaskNames: jasmine.createSpy('setUpcomingTaskNames'),
  };
}

async function setup(initialTemplates: ScheduleTemplate[] = []) {
  const { mock: templatesSvcMock, templatesSignal } = makeTemplatesSvcMock(initialTemplates);
  const stateMock = makeStateMock();

  templatesSvcMock.create.and.returnValue(of(makeTemplate()));
  templatesSvcMock.delete.and.returnValue(of(undefined));

  await TestBed.configureTestingModule({
    imports: [RoutinesTasksSubstepComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ScheduleTemplatesService, useValue: templatesSvcMock },
      { provide: OnboardingStateService, useValue: stateMock },
    ],
  }).compileComponents();

  const fixture: ComponentFixture<RoutinesTasksSubstepComponent> =
    TestBed.createComponent(RoutinesTasksSubstepComponent);
  const component = fixture.componentInstance;
  return { fixture, component, templatesSvcMock, stateMock, templatesSignal };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RoutinesTasksSubstepComponent', () => {

  // ── 1. Renders two sections with correct subtitles ──────────────────────────

  it('renders the Recurring Routines section subtitle', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const subtitles: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.section-subtitle');
    const texts = Array.from(subtitles).map(el => el.textContent ?? '');
    expect(texts.some(t => t.includes('Things you do on a regular schedule'))).toBeTrue();
  });

  it('renders the Upcoming Tasks section subtitle', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const subtitles: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.section-subtitle');
    const texts = Array.from(subtitles).map(el => el.textContent ?? '');
    expect(texts.some(t => t.includes('One-off things to get done'))).toBeTrue();
  });

  // ── 2. Add button disabled when name input is empty ─────────────────────────

  it('routine Add button is disabled when routine name is empty', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const addBtns: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.add-btn');
    // First add button belongs to the routines section
    expect(addBtns[0].disabled).toBeTrue();
  });

  it('task Add button is disabled when task name is empty', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const addBtns: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.add-btn');
    // Second add button belongs to the tasks section
    expect(addBtns[1].disabled).toBeTrue();
  });

  // ── 3. Adding a routine via form calls create() and shows a chip ────────────

  it('adding a routine via form calls ScheduleTemplatesService.create() and shows a chip', async () => {
    const { fixture, component, templatesSvcMock } = await setup();
    fixture.detectChanges();

    component.routineName = 'Yoga';
    component.selectedRrule = 'FREQ=DAILY';
    fixture.detectChanges();

    const addBtns: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.add-btn');
    addBtns[0].click();
    fixture.detectChanges();

    expect(templatesSvcMock.create).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ title: 'Yoga', recurrence: 'daily' })
    );

    const chips = fixture.nativeElement.querySelectorAll('.routine-chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  // ── 4. Adding via inspiration chip calls create(); chip disappears from list ─

  it('tapping an inspiration chip calls create() immediately and removes it from the inspiration list', async () => {
    const { fixture, templatesSvcMock } = await setup();
    fixture.detectChanges();

    const inspirationChips: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.inspiration-chip');
    const initialCount = inspirationChips.length;
    expect(initialCount).toBeGreaterThan(0);

    // Click the first inspiration chip
    inspirationChips[0].click();
    fixture.detectChanges();

    expect(templatesSvcMock.create).toHaveBeenCalledTimes(1);

    const newChips: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.inspiration-chip');
    expect(newChips.length).toBe(initialCount - 1);
  });

  // ── 5. Removing a routine chip calls delete() and removes the chip ──────────

  it('removing a routine chip calls ScheduleTemplatesService.delete() and removes the chip', async () => {
    const existingTemplate = makeTemplate({ template_id: 'tmpl-99', title: 'Yoga' });
    const { fixture, templatesSvcMock } = await setup([existingTemplate]);
    fixture.detectChanges();

    let chips = fixture.nativeElement.querySelectorAll('.routine-chip');
    expect(chips.length).toBe(1);

    const removeBtn: HTMLButtonElement = chips[0].querySelector('.chip-remove')!;
    removeBtn.click();
    fixture.detectChanges();

    expect(templatesSvcMock.delete).toHaveBeenCalledOnceWith('tmpl-99');

    chips = fixture.nativeElement.querySelectorAll('.routine-chip');
    expect(chips.length).toBe(0);
  });

  // ── 6. Adding a task via form appends to task names list ────────────────────

  it('adding a task via form appends to task names and shows a chip', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();

    component.taskName = 'Call dentist';
    fixture.detectChanges();

    const addBtns: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.add-btn');
    addBtns[1].click();
    fixture.detectChanges();

    expect(component.taskNames()).toContain('Call dentist');
    // There should be at least one .routine-chip rendered (for the task chip)
    const allChips = fixture.nativeElement.querySelectorAll('.routine-chip');
    expect(allChips.length).toBeGreaterThan(0);
  });

  // ── 7. Removing a task chip removes from local list (no service call) ────────

  it('removing a task chip removes it from local list and does NOT call any service', async () => {
    const { fixture, component, templatesSvcMock } = await setup();
    fixture.detectChanges();

    // Add a task
    component.addTask();  // taskName is '' so nothing happens
    component.taskName = 'Buy groceries';
    component.addTask();
    fixture.detectChanges();

    expect(component.taskNames()).toContain('Buy groceries');

    // Remove by index (0 is the only task)
    component.removeTask(0);
    fixture.detectChanges();

    expect(component.taskNames()).not.toContain('Buy groceries');
    expect(templatesSvcMock.delete).not.toHaveBeenCalled();
    expect(templatesSvcMock.create).not.toHaveBeenCalled();
  });

  // ── 8. "Save & Continue →" calls both state setters and emits complete ───────

  it('"Save & Continue →" calls setScheduleTemplates + setUpcomingTaskNames + emits complete', async () => {
    const { fixture, component, stateMock } = await setup();
    fixture.detectChanges();

    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);

    component.taskName = 'Walk the cat';
    component.addTask();

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();

    expect(stateMock.setScheduleTemplates).toHaveBeenCalledTimes(1);
    expect(stateMock.setUpcomingTaskNames).toHaveBeenCalledWith(jasmine.arrayContaining(['Walk the cat']));
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  });

  // ── 9. Save works with zero routines and zero tasks ─────────────────────────

  it('save works even with zero routines and zero tasks (empty state is valid)', async () => {
    const { fixture, component, stateMock } = await setup();
    fixture.detectChanges();

    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);

    component.save();
    fixture.detectChanges();

    expect(stateMock.setScheduleTemplates).toHaveBeenCalledTimes(1);
    expect(stateMock.setUpcomingTaskNames).toHaveBeenCalledWith([]);
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  });

  // ── 10. Day picker shows when "Weekly…" recurrence is selected ───────────────

  it('shows day picker when "Weekly…" recurrence is selected', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();

    // Day picker should not be visible with the default 'FREQ=DAILY' selection
    let dayRow: HTMLElement | null = fixture.nativeElement.querySelector('.day-row');
    expect(dayRow).toBeNull();

    // Select "Weekly…"
    component.selectedRrule = 'FREQ=WEEKLY;BYDAY=';
    fixture.detectChanges();

    dayRow = fixture.nativeElement.querySelector('.day-row');
    expect(dayRow).not.toBeNull();
  });
});
