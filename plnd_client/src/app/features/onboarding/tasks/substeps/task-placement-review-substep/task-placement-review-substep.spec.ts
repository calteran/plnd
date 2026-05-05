import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { TaskPlacementReviewSubstepComponent } from './task-placement-review-substep';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { ConfigService } from '../../../../../core/services/config.service';
import { PlaceTasksEntry, PlanEntryRequest } from '../../../../../core/models/week-plan';
import { ScheduleTemplate } from '../../../../../core/models/schedule-template';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000';

const PLAN_PERIOD = { start: '2026-04-28', end: '2026-04-30' };

const MOCK_ENTRIES: PlaceTasksEntry[] = [
  {
    title: 'Morning Walk',
    scheduled_date: '2026-04-28',
    time_window_start: '08:00',
    duration_minutes: 30,
    energy_required: 'medium',
    task_type: 'exercise',
  },
  {
    title: 'Read Book',
    scheduled_date: '2026-04-28',
    time_window_start: '13:00',
    duration_minutes: 45,
    energy_required: 'low',
    task_type: 'leisure',
  },
  {
    title: 'Evening Run',
    scheduled_date: '2026-04-29',
    time_window_start: '18:00',
    duration_minutes: 40,
    energy_required: 'high',
    task_type: 'exercise',
  },
];

function makeTemplate(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    template_id: 'tpl-1',
    user_id: 'user-1',
    task_type: 'general',
    title: 'Daily Routine',
    recurrence: 'daily',
    recurrence_rule: 'FREQ=DAILY',
    time_window_start: '08:00',
    time_window_end: null,
    duration_minutes: 30,
    energy_required: 'low',
    is_anchor: false,
    task_ref_id: null,
    task_ref_type: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeStateMock(
  taskNames: string[] = ['Morning Walk', 'Read Book', 'Evening Run'],
  period: { start: string; end: string } | null = PLAN_PERIOD,
  scheduleTemplates: ScheduleTemplate[] = [],
) {
  const taskNamesSignal: WritableSignal<string[]> = signal(taskNames);
  const periodSignal: WritableSignal<{ start: string; end: string } | null> = signal(period);
  const templatesSignal: WritableSignal<ScheduleTemplate[]> = signal(scheduleTemplates);
  const routineCountSignal: WritableSignal<number> = signal(0);

  return {
    upcomingTaskNames: taskNamesSignal.asReadonly(),
    planPeriod: periodSignal.asReadonly(),
    scheduleTemplates: templatesSignal.asReadonly(),
    totalRoutines: routineCountSignal.asReadonly(),
    setPlacedTasks: jasmine.createSpy('setPlacedTasks'),
    markComplete: jasmine.createSpy('markComplete'),
  };
}

const CONFIG_MOCK = {
  getConfig: () => ({ api: { baseUrl: API_BASE } }),
};

// ── Setup helper ──────────────────────────────────────────────────────────────

async function setup(
  taskNames: string[] = ['Morning Walk', 'Read Book', 'Evening Run'],
  period: { start: string; end: string } | null = PLAN_PERIOD,
  scheduleTemplates: ScheduleTemplate[] = [],
) {
  const stateMock = makeStateMock(taskNames, period, scheduleTemplates);

  await TestBed.configureTestingModule({
    imports: [TaskPlacementReviewSubstepComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: OnboardingStateService, useValue: stateMock },
      { provide: ConfigService, useValue: CONFIG_MOCK },
    ],
  }).compileComponents();

  const fixture: ComponentFixture<TaskPlacementReviewSubstepComponent> =
    TestBed.createComponent(TaskPlacementReviewSubstepComponent);
  const component = fixture.componentInstance;
  const httpController = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);

  return { fixture, component, stateMock, httpController, router };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TaskPlacementReviewSubstepComponent', () => {

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  // ── 1. Empty state when upcomingTaskNames is empty ───────────────────────────

  it('shows empty state when both upcomingTaskNames and scheduleTemplates are empty', async () => {
    const { fixture } = await setup([], PLAN_PERIOD, []);
    fixture.detectChanges();
    const emptyMsg: HTMLElement | null = fixture.nativeElement.querySelector('.empty-msg');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg!.textContent).toContain('No tasks or routines to place');
  });

  it('shows empty state when planPeriod is null', async () => {
    const { fixture } = await setup(['Task A'], null, []);
    fixture.detectChanges();
    const emptyMsg: HTMLElement | null = fixture.nativeElement.querySelector('.empty-msg');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg!.textContent).toContain('No tasks or routines to place');
  });

  // ── 2. Loading state while API call is in flight ─────────────────────────────

  it('shows loading screen while API call is in flight', fakeAsync(async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    const loadingScreen: HTMLElement | null =
      fixture.nativeElement.querySelector('app-onboarding-loading-screen');
    expect(loadingScreen).not.toBeNull();

    const h2: HTMLElement | null = loadingScreen!.querySelector('h2');
    expect(h2?.textContent?.trim()).toBe('Building your plan');

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();
    tick(10000); // flush loading screen timers before test teardown
  }));

  // ── 3. Calls POST /agent/place-tasks with correct body ───────────────────────

  it('calls POST /agent/place-tasks with correct body on init', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    const req = httpController.expectOne(`${API_BASE}/agent/place-tasks`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      task_names: ['Morning Walk', 'Read Book', 'Evening Run'],
      routine_templates: [],
      plan_start: PLAN_PERIOD.start,
      plan_end: PLAN_PERIOD.end,
    });
    req.flush(MOCK_ENTRIES);
    fixture.detectChanges();
  });

  // ── 4. Renders day cards grouped by date after successful API response ────────

  it('renders day cards grouped by date after successful API response', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const dayCards = fixture.nativeElement.querySelectorAll('.day-card');
    // Plan period: Apr 28–30 = 3 days
    expect(dayCards.length).toBe(3);
  });

  it('shows task titles in the correct day cards', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const taskTitles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.task-title'));
    const titleTexts = taskTitles.map(el => el.textContent?.trim());
    expect(titleTexts).toContain('Morning Walk');
    expect(titleTexts).toContain('Read Book');
    expect(titleTexts).toContain('Evening Run');
  });

  // ── 5. Meal slot dividers appear in each day card ────────────────────────────

  it('renders BREAKFAST, LUNCH, DINNER dividers in each day card', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const dayCards = fixture.nativeElement.querySelectorAll('.day-card');
    for (const card of Array.from(dayCards) as HTMLElement[]) {
      const labels: string[] = Array.from<HTMLElement>(card.querySelectorAll('.meal-label'))
        .map(el => el.textContent?.trim() ?? '');
      expect(labels).toContain('BREAKFAST');
      expect(labels).toContain('LUNCH');
      expect(labels).toContain('DINNER');
    }
  });

  // ── 6. Meal slot note appears below grid ────────────────────────────────────

  it('shows meal slot note below grid', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const note: HTMLElement | null = fixture.nativeElement.querySelector('.meal-slot-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('Meal slots will fill in once you complete the Food & Meals section.');
  });

  // ── 7. Edit button opens edit form; closes other open editors ────────────────

  it('clicking Edit opens the edit form for that task row', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const editBtns: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.edit-btn'));
    expect(editBtns.length).toBeGreaterThan(0);
    editBtns[0].click();
    fixture.detectChanges();

    const editForm = fixture.nativeElement.querySelector('.task-row--editing');
    expect(editForm).not.toBeNull();
  });

  it('clicking Edit on a second task closes the first editor and opens the new one', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const editBtns: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.edit-btn'));
    expect(editBtns.length).toBeGreaterThanOrEqual(2);

    // Open first editor
    editBtns[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.task-row--editing').length).toBe(1);

    // Re-query edit buttons (DOM has changed) and open second editor
    const editBtnsAfter: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.edit-btn'));
    editBtnsAfter[0].click();
    fixture.detectChanges();

    // Still only one editor open
    expect(fixture.nativeElement.querySelectorAll('.task-row--editing').length).toBe(1);
  });

  // ── 8. Save in edit form updates the entry ────────────────────────────────────

  it('saving edit form updates date, time, duration, and energy', async () => {
    const { fixture, component, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    // Open edit for first entry (Morning Walk, index 0)
    component.openEdit(0);
    fixture.detectChanges();

    // Update all editable fields
    component.onEditDate('2026-04-29');
    component.onEditTime('10:00');
    component.onEditDuration(60);
    component.onEditEnergy('high');

    component.saveEdit();
    fixture.detectChanges();

    const updated = component.entries()[0];
    expect(updated.scheduled_date).toBe('2026-04-29');
    expect(updated.time_window_start).toBe('10:00');
    expect(updated.duration_minutes).toBe(60);
    expect(updated.energy_required).toBe('high');

    // Edit form should be closed
    expect(fixture.nativeElement.querySelector('.task-row--editing')).toBeNull();
  });

  // ── 9. Remove in edit form deletes the entry ─────────────────────────────────

  it('removing an entry from the edit form deletes it from the list', async () => {
    const { fixture, component, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    expect(component.entries().length).toBe(3);

    component.openEdit(0);
    component.removeEntry(0);
    fixture.detectChanges();

    expect(component.entries().length).toBe(2);

    const taskTitles: string[] = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.task-title'))
      .map(el => el.textContent?.trim() ?? '');
    expect(taskTitles).not.toContain('Morning Walk');
  });

  // ── 10. Save & Return calls setPlacedTasks, markComplete, navigates, emits ───

  it('"Save & Return to Hub" calls setPlacedTasks, markComplete, navigates, and emits complete', fakeAsync(async () => {
    const { fixture, component, stateMock, httpController, router } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);

    const navigateSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();
    tick();

    // Verify setPlacedTasks called with mapped entries
    expect(stateMock.setPlacedTasks).toHaveBeenCalledTimes(1);
    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.calls.first().args[0];
    expect(placedArg.length).toBe(3);
    expect(placedArg[0].date).toBe(MOCK_ENTRIES[0].scheduled_date);
    expect(placedArg[0].scheduled_start).toBe(MOCK_ENTRIES[0].time_window_start!);
    expect(placedArg[0].task_type).toBe(MOCK_ENTRIES[0].task_type);

    expect(stateMock.markComplete).toHaveBeenCalledWith('tasks');
    expect(navigateSpy).toHaveBeenCalledWith(['/onboarding']);
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  }));

  // ── 11. Save & Return works with empty task list ─────────────────────────────

  it('"Save & Return to Hub" works correctly with an empty task list', fakeAsync(async () => {
    const { fixture, component, stateMock, httpController, router } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    // Remove all entries
    // Remove from last to first to avoid re-index issues
    component.removeEntry(2);
    component.removeEntry(1);
    component.removeEntry(0);
    fixture.detectChanges();

    expect(component.entries().length).toBe(0);

    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);

    const navigateSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();
    tick();

    expect(stateMock.setPlacedTasks).toHaveBeenCalledWith([]);
    expect(stateMock.markComplete).toHaveBeenCalledWith('tasks');
    expect(navigateSpy).toHaveBeenCalledWith(['/onboarding']);
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  }));

  // ── Error state ───────────────────────────────────────────────────────────────

  it('shows error message when API call fails', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).error(new ProgressEvent('error'));
    fixture.detectChanges();

    const errorMsg: HTMLElement | null = fixture.nativeElement.querySelector('.error-msg');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg!.textContent).toContain('Failed to place tasks');
  });

  it('retry button calls loadPlacement again', async () => {
    const { fixture, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).error(new ProgressEvent('error'));
    fixture.detectChanges();

    const retryBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.retry-btn');
    expect(retryBtn).not.toBeNull();
    retryBtn.click();
    fixture.detectChanges();

    // A second request should be pending
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.error-msg')).toBeNull();
  });

  // ── Routines-only (no tasks) ─────────────────────────────────────────────────

  it('shows loading screen, calls agent, and shows Edit buttons for routines-only scenario', fakeAsync(async () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=DAILY' });
    const routinePlacedEntries: PlaceTasksEntry[] = [
      { title: 'Daily Routine', scheduled_date: '2026-04-28', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
      { title: 'Daily Routine', scheduled_date: '2026-04-29', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
      { title: 'Daily Routine', scheduled_date: '2026-04-30', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
    ];
    const { fixture, component, stateMock, httpController, router } = await setup([], PLAN_PERIOD, [template]);
    fixture.detectChanges();

    // Loading screen visible while agent is in flight
    expect(fixture.nativeElement.querySelector('app-onboarding-loading-screen')).not.toBeNull();

    // Agent IS called even for routines-only — it schedules templates server-side
    const req = httpController.expectOne(`${API_BASE}/agent/place-tasks`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.task_names).toEqual([]);
    expect(req.request.body.routine_templates.length).toBe(1);
    expect(req.request.body.routine_templates[0].title).toBe('Daily Routine');
    req.flush(routinePlacedEntries);
    fixture.detectChanges();
    tick(10000);

    const dayCards = fixture.nativeElement.querySelectorAll('.day-card');
    expect(dayCards.length).toBe(3);
    const taskTitles: string[] = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('.task-title')
    ).map(el => el.textContent?.trim() ?? '');
    expect(taskTitles).toContain('Daily Routine');

    // All returned rows have Edit buttons
    expect(fixture.nativeElement.querySelectorAll('.edit-btn').length).toBe(3);

    // Save & Return sends LLM-placed routine entries as placed_tasks
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    component.complete.subscribe(jasmine.createSpy('complete'));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.save-btn')!.click();
    fixture.detectChanges();
    tick();

    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.calls.first().args[0];
    expect(placedArg.length).toBe(3);
    expect(placedArg[0].title).toBe('Daily Routine');
  }));

  // ── Routines + tasks (unified agent response) ─────────────────────────────────

  it('shows both routine instances and one-off tasks from a unified agent response', fakeAsync(async () => {
    const template = makeTemplate({ title: 'Medication', recurrence_rule: 'FREQ=DAILY' });
    const agentEntries: PlaceTasksEntry[] = [
      MOCK_ENTRIES[0], // Morning Walk
      { title: 'Medication', scheduled_date: '2026-04-28', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
    ];
    const { fixture, component, stateMock, httpController, router } = await setup(
      ['Morning Walk'],
      PLAN_PERIOD,
      [template],
    );
    fixture.detectChanges();

    // Agent receives both task_names and routine_templates
    const req = httpController.expectOne(`${API_BASE}/agent/place-tasks`);
    expect(req.request.body.task_names).toEqual(['Morning Walk']);
    expect(req.request.body.routine_templates.length).toBe(1);
    expect(req.request.body.routine_templates[0].title).toBe('Medication');
    req.flush(agentEntries);
    fixture.detectChanges();
    tick(10000);

    const taskTitles: string[] = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('.task-title')
    ).map(el => el.textContent?.trim() ?? '');
    expect(taskTitles).toContain('Morning Walk');
    expect(taskTitles).toContain('Medication');

    // All rows have Edit buttons — no more display-only rows
    expect(fixture.nativeElement.querySelectorAll('.edit-btn').length).toBe(2);

    // Save & Return sends ALL entries (routine + one-off) as placed_tasks
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    component.complete.subscribe(jasmine.createSpy('complete'));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.save-btn')!.click();
    fixture.detectChanges();
    tick();

    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.calls.first().args[0];
    expect(placedArg.length).toBe(2);
    expect(placedArg.map(e => e.title)).toContain('Morning Walk');
    expect(placedArg.map(e => e.title)).toContain('Medication');
  }));

  // ── Edit / remove work on any row ────────────────────────────────────────────

  it('opening Edit on any row opens the edit form and saves correctly', async () => {
    const { fixture, component, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    // Open edit on entry 1 (Read Book, index 1)
    component.openEdit(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.task-row--editing')).not.toBeNull();

    component.onEditDate('2026-04-30');
    component.onEditDuration(90);
    component.saveEdit();
    fixture.detectChanges();

    const updated = component.entries()[1];
    expect(updated.scheduled_date).toBe('2026-04-30');
    expect(updated.duration_minutes).toBe(90);
    expect(fixture.nativeElement.querySelector('.task-row--editing')).toBeNull();
  });

  it('removing an entry re-indexes the list so subsequent edits target the correct entry', async () => {
    const { fixture, component, httpController } = await setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    // Remove first entry (Morning Walk, index 0)
    component.removeEntry(0);
    fixture.detectChanges();

    expect(component.entries().length).toBe(2);
    // Read Book was index 1, now index 0
    expect(component.entries()[0].title).toBe('Read Book');
    // Opening edit 0 should target Read Book
    component.openEdit(0);
    expect(component.editState()?.entryIndex).toBe(0);
  });

});

