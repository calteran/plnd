import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  TaskPlacementReviewSubstepComponent,
  bucketOf,
  buildDayCards,
  buildDaySections,
} from './task-placement-review-substep';
import { MealPatternEntry } from '../../../../../core/models/meal-pattern';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { ConfigService } from '../../../../../core/services/config.service';
import { DayTypeResponse } from '../../../../../core/models/day-type';
import { PlaceTasksEntry, PlanEntryRequest } from '../../../../../core/models/week-plan';
import { Routine } from '../../../../../core/models/routine';

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

function makeTemplate(overrides: Partial<Routine> = {}): Routine {
  return {
    routine_id: 'tpl-1',
    user_id: 'user-1',
    task_type: 'general',
    title: 'Daily Routine',
    recurrence_tag: 'daily',
    recurrence_rule: 'FREQ=DAILY',
    time_window_start: '08:00',
    time_window_end: null,
    duration_minutes: 30,
    energy_required: 'low',
    is_anchor: false,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeStateMock(
  taskNames: string[] = ['Morning Walk', 'Read Book', 'Evening Run'],
  period: { start: string; end: string } | null = PLAN_PERIOD,
  routines: Routine[] = [],
) {
  const taskNamesSignal: WritableSignal<string[]> = signal(taskNames);
  const periodSignal: WritableSignal<{ start: string; end: string } | null> = signal(period);
  const routinesSignal: WritableSignal<Routine[]> = signal(routines);
  const routineCountSignal: WritableSignal<number> = signal(0);
  const dayTypesSignal: WritableSignal<DayTypeResponse[]> = signal([{
    id: 'default-dt', user_id: 'u1', name: 'Default',
    days_bitmask: 127,
    wake_time: '07:00:00', sleep_time: '22:00:00',
    is_cycle: false,
    cycle_length: null, anchor_date: null, cycle_bitmask: 0,
    created_at: '2026-01-01T00:00:00Z',
    meals: [
      { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: 'u1', day_type_id: 'default-dt', created_at: '', updated_at: '' },
      { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: 'u1', day_type_id: 'default-dt', created_at: '', updated_at: '' },
      { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: 'u1', day_type_id: 'default-dt', created_at: '', updated_at: '' },
    ],
  }]);

  return {
    upcomingTaskNames: taskNamesSignal.asReadonly(),
    planPeriod: periodSignal.asReadonly(),
    routines: routinesSignal.asReadonly(),
    totalRoutines: routineCountSignal.asReadonly(),
    dayTypes: dayTypesSignal.asReadonly(),
    setPlacedTasks: vi.fn(),
    markComplete: vi.fn(),
  };
}

const CONFIG_MOCK = {
  getConfig: () => ({ api: { baseUrl: API_BASE } }),
};

// ── Setup helper ──────────────────────────────────────────────────────────────

function setup(
  taskNames: string[] = ['Morning Walk', 'Read Book', 'Evening Run'],
  period: { start: string; end: string } | null = PLAN_PERIOD,
  routines: Routine[] = [],
) {
  const stateMock = makeStateMock(taskNames, period, routines);

  TestBed.configureTestingModule({
    imports: [TaskPlacementReviewSubstepComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: OnboardingStateService, useValue: stateMock },
      { provide: ConfigService, useValue: CONFIG_MOCK },
    ],
  });

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

  it('shows empty state when both upcomingTaskNames and routines are empty', async () => {
    const { fixture } = setup([], PLAN_PERIOD, []);
    fixture.detectChanges();
    const emptyMsg: HTMLElement | null = fixture.nativeElement.querySelector('.empty-msg');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg!.textContent).toContain('No tasks or routines to place');
  });

  it('shows empty state when planPeriod is null', async () => {
    const { fixture } = setup(['Task A'], null, []);
    fixture.detectChanges();
    const emptyMsg: HTMLElement | null = fixture.nativeElement.querySelector('.empty-msg');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg!.textContent).toContain('No tasks or routines to place');
  });

  // ── 2. Loading state while API call is in flight ─────────────────────────────

  it('shows loading screen while API call is in flight', fakeAsync(() => {
    const { fixture, httpController } = setup();
    fixture.detectChanges();

    const loadingScreen: HTMLElement | null =
      fixture.nativeElement.querySelector('app-onboarding-task-loading');
    expect(loadingScreen).not.toBeNull();

    const h2: HTMLElement | null = loadingScreen!.querySelector('h2');
    expect(h2?.textContent?.trim()).toBe('Building your plan');

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();
    tick(10000); // flush loading screen timers before test teardown
  }));

  // ── 3. Calls POST /agent/place-tasks with correct body ───────────────────────

  it('calls POST /agent/place-tasks with correct body on init', async () => {
    const { fixture, httpController } = setup();
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
    const { fixture, httpController } = setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const dayCards = fixture.nativeElement.querySelectorAll('.day-card');
    // Plan period: Apr 28–30 = 3 days
    expect(dayCards.length).toBe(3);
  });

  it('shows task titles in the correct day cards', async () => {
    const { fixture, httpController } = setup();
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
    const { fixture, httpController } = setup();
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
    const { fixture, httpController } = setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const note: HTMLElement | null = fixture.nativeElement.querySelector('.meal-slot-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('Meal slots will fill in once you complete the Food & Meals section.');
  });

  // ── 7. Edit button opens edit form; closes other open editors ────────────────

  it('clicking Edit opens the edit form for that task row', async () => {
    const { fixture, httpController } = setup();
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
    const { fixture, httpController } = setup();
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
    const { fixture, component, httpController } = setup();
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
    const { fixture, component, httpController } = setup();
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

  it('"Save & Return to Hub" calls setPlacedTasks, markComplete, navigates, and emits complete', fakeAsync(() => {
    const { fixture, component, stateMock, httpController, router } = setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush(MOCK_ENTRIES);
    fixture.detectChanges();

    const completeSpy = vi.fn();
    component.complete.subscribe(completeSpy);

    const navigateSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();
    tick();

    // Verify setPlacedTasks called with mapped entries
    expect(stateMock.setPlacedTasks).toHaveBeenCalledTimes(1);
    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.mock.calls[0][0];
    expect(placedArg.length).toBe(3);
    expect(placedArg[0].date).toBe(MOCK_ENTRIES[0].scheduled_date);
    expect(placedArg[0].scheduled_start).toBe(MOCK_ENTRIES[0].time_window_start!);
    expect(placedArg[0].task_type).toBe(MOCK_ENTRIES[0].task_type);

    expect(stateMock.markComplete).toHaveBeenCalledWith('tasks');
    expect(navigateSpy).toHaveBeenCalledWith(['/onboarding']);
    expect(completeSpy).toHaveBeenCalledExactlyOnceWith(undefined);
  }));

  // ── 10b. Floating (anchor-relative) tasks are saved with no scheduled_start ──

  it('saves an anchor-relative task with no scheduled_start so the day view keeps it in its slot', fakeAsync(() => {
    const { fixture, component, stateMock, httpController, router } = setup(['Meds'], PLAN_PERIOD, []);
    fixture.detectChanges();

    // A floating task: placed by anchor, with NO fixed clock time.
    const floatingEntry: PlaceTasksEntry = {
      title: 'Meds',
      scheduled_date: '2026-04-28',
      after_anchor: 'breakfast',
      duration_minutes: 5,
      energy_required: 'low',
      task_type: 'general',
    };
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([floatingEntry]);
    fixture.detectChanges();

    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
    component.complete.subscribe(vi.fn());

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.save-btn')!.click();
    fixture.detectChanges();
    tick();

    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.mock.calls[0][0];
    expect(placedArg.length).toBe(1);
    expect(placedArg[0].after_anchor).toBe('breakfast');
    // Must NOT fabricate a noon clock time — that would reclassify the task as a
    // fixed scheduled_task at lunch in the day view (the bug being fixed).
    expect(placedArg[0].scheduled_start).toBeFalsy();
  }));

  // ── 11. Save & Return works with empty task list ─────────────────────────────

  it('"Save & Return to Hub" works correctly with an empty task list', fakeAsync(() => {
    const { fixture, component, stateMock, httpController, router } = setup();
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

    const completeSpy = vi.fn();
    component.complete.subscribe(completeSpy);

    const navigateSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();
    tick();

    expect(stateMock.setPlacedTasks).toHaveBeenCalledWith([]);
    expect(stateMock.markComplete).toHaveBeenCalledWith('tasks');
    expect(navigateSpy).toHaveBeenCalledWith(['/onboarding']);
    expect(completeSpy).toHaveBeenCalledExactlyOnceWith(undefined);
  }));

  // ── Error state ───────────────────────────────────────────────────────────────

  it('shows error message when API call fails', async () => {
    const { fixture, httpController } = setup();
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).error(new ProgressEvent('error'));
    fixture.detectChanges();

    const errorMsg: HTMLElement | null = fixture.nativeElement.querySelector('.error-msg');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg!.textContent).toContain('Failed to place tasks');
  });

  it('retry button calls loadPlacement again', async () => {
    const { fixture, httpController } = setup();
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

  it('shows loading screen, calls agent, and shows Edit buttons for routines-only scenario', fakeAsync(() => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=DAILY' });
    const routinePlacedEntries: PlaceTasksEntry[] = [
      { title: 'Daily Routine', scheduled_date: '2026-04-28', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
      { title: 'Daily Routine', scheduled_date: '2026-04-29', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
      { title: 'Daily Routine', scheduled_date: '2026-04-30', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
    ];
    const { fixture, component, stateMock, httpController, router } = setup([], PLAN_PERIOD, [template]);
    fixture.detectChanges();

    // Loading screen visible while agent is in flight
    expect(fixture.nativeElement.querySelector('app-onboarding-task-loading')).not.toBeNull();

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
    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
    component.complete.subscribe(vi.fn());
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.save-btn')!.click();
    fixture.detectChanges();
    tick();

    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.mock.calls[0][0];
    expect(placedArg.length).toBe(3);
    expect(placedArg[0].title).toBe('Daily Routine');
  }));

  // ── Routines + tasks (unified agent response) ─────────────────────────────────

  it('shows both routine instances and one-off tasks from a unified agent response', fakeAsync(() => {
    const template = makeTemplate({ title: 'Medication', recurrence_rule: 'FREQ=DAILY' });
    const agentEntries: PlaceTasksEntry[] = [
      MOCK_ENTRIES[0], // Morning Walk
      { title: 'Medication', scheduled_date: '2026-04-28', time_window_start: '08:00', duration_minutes: 30, energy_required: 'low', task_type: 'general' },
    ];
    const { fixture, component, stateMock, httpController, router } = setup(
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
    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
    component.complete.subscribe(vi.fn());
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.save-btn')!.click();
    fixture.detectChanges();
    tick();

    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.mock.calls[0][0];
    expect(placedArg.length).toBe(2);
    expect(placedArg.map(e => e.title)).toContain('Morning Walk');
    expect(placedArg.map(e => e.title)).toContain('Medication');
  }));

  // ── Edit / remove work on any row ────────────────────────────────────────────

  it('opening Edit on any row opens the edit form and saves correctly', async () => {
    const { fixture, component, httpController } = setup();
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
    const { fixture, component, httpController } = setup();
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

  // ── toPlanEntries() mapping ───────────────────────────────────────────────────

  it('maps reordered placements to contiguous slot_position and paired_meal_name', async () => {
    const { component } = setup();
    // Don't call detectChanges — we bypass the HTTP load and set entries directly.
    component.entries.set([
      { title: 'a', scheduled_date: '2026-06-22', task_type: 'work', duration_minutes: 30,
        energy_required: 'low', after_anchor: 'lunch' },
      { title: 'b', scheduled_date: '2026-06-22', task_type: 'work', duration_minutes: 30,
        energy_required: 'low', after_anchor: 'lunch' },
      { title: 'c', scheduled_date: '2026-06-22', task_type: 'medication', duration_minutes: 5,
        energy_required: 'low', paired_meal_name: 'breakfast' },
    ] as PlaceTasksEntry[]);

    const planEntries = component.toPlanEntries();
    const lunch = planEntries.filter(e => e.after_anchor === 'lunch');
    expect(lunch.map(e => e.slot_position)).toEqual([0, 1]);
    expect(planEntries.find(e => e.paired_meal_name === 'breakfast')?.slot_position).toBe(0);
  });

  it('paired task carries paired_meal_name and null scheduled_start', async () => {
    const { component } = setup();
    component.entries.set([
      { title: 'take meds', scheduled_date: '2026-06-22', task_type: 'medication',
        duration_minutes: 5, energy_required: 'low', paired_meal_name: 'breakfast' },
    ] as PlaceTasksEntry[]);

    const planEntries = component.toPlanEntries();
    expect(planEntries[0].paired_meal_name).toBe('breakfast');
    expect(planEntries[0].scheduled_start).toBeNull();
    expect(planEntries[0].after_anchor).toBeUndefined();
  });

  // ── onDrop() same-day cross-slot (into-meal pairing) ─────────────────────────

  it('same-day drop into meal slot sets paired_meal_name and leaves exactly ONE instance', async () => {
    const { component, httpController, fixture } = setup();
    fixture.detectChanges();
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([
      { title: 'Walk', scheduled_date: '2026-04-28', task_type: 'exercise',
        duration_minutes: 30, energy_required: 'medium', after_anchor: 'lunch' },
    ] as PlaceTasksEntry[]);
    fixture.detectChanges();

    const entry = component.entries()[0];
    const dropEvent = {
      item: { data: entry },
      previousIndex: 0,
      currentIndex: 0,
      container: { data: [entry] },
      previousContainer: { data: [entry] },
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
    } as unknown as CdkDragDrop<PlaceTasksEntry[]>;

    // Drop into 'breakfast' slot on the same date
    (component as unknown as { onDrop(e: CdkDragDrop<PlaceTasksEntry[]>, date: string, slotKey: string): void })
      .onDrop(dropEvent, '2026-04-28', 'breakfast');

    const allWalks = component.entries().filter(e => e.title === 'Walk');
    expect(allWalks.length).toBe(1);
    expect(allWalks[0].scheduled_date).toBe('2026-04-28');
    expect(allWalks[0].paired_meal_name).toBe('breakfast');
  });

  it('same-slot reorder: inserts canonical entry and changes order without duplication', async () => {
    const { component, httpController, fixture } = setup();
    fixture.detectChanges();
    // Two tasks already in the SAME slot (breakfast) on the SAME date
    const entryA: PlaceTasksEntry = {
      title: 'Task A',
      scheduled_date: '2026-04-28',
      task_type: 'general',
      duration_minutes: 15,
      energy_required: 'low',
      paired_meal_name: 'breakfast',
    };
    const entryB: PlaceTasksEntry = {
      title: 'Task B',
      scheduled_date: '2026-04-28',
      task_type: 'general',
      duration_minutes: 15,
      energy_required: 'low',
      paired_meal_name: 'breakfast',
    };
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([entryA, entryB]);
    fixture.detectChanges();

    // Simulate: drag Task A (currentIndex=0) to after Task B (currentIndex=1) within same slot
    const currentEntry = component.entries()[0]; // Task A reference in signal
    const dropEvent = {
      item: { data: currentEntry },
      previousIndex: 0,
      currentIndex: 1,
      container: { data: [currentEntry, component.entries()[1]] },
      previousContainer: { data: [currentEntry, component.entries()[1]] },
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
    } as unknown as CdkDragDrop<PlaceTasksEntry[]>;

    (component as unknown as { onDrop(e: CdkDragDrop<PlaceTasksEntry[]>, date: string, slotKey: string): void })
      .onDrop(dropEvent, '2026-04-28', 'breakfast');

    // (a) Exactly one instance of Task A
    const allAs = component.entries().filter(e => e.title === 'Task A');
    expect(allAs.length).toBe(1);

    // (b) Order changed: Task B should now come before Task A
    const titles = component.entries().map(e => e.title);
    expect(titles.indexOf('Task B')).toBeLessThan(titles.indexOf('Task A'));

    // (c) Moved entry holds canonical slot fields (not stale: paired_meal_name preserved)
    expect(allAs[0].scheduled_date).toBe('2026-04-28');
    expect(allAs[0].paired_meal_name).toBe('breakfast');
  });

  it('cross-day drop changes scheduled_date and leaves exactly ONE instance', async () => {
    const { component, httpController, fixture } = setup();
    fixture.detectChanges();
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([
      { title: 'Walk', scheduled_date: '2026-04-28', task_type: 'exercise',
        duration_minutes: 30, energy_required: 'medium', after_anchor: 'lunch' },
    ] as PlaceTasksEntry[]);
    fixture.detectChanges();

    const entry = component.entries()[0];
    const dropEvent = {
      item: { data: entry },
      previousIndex: 0,
      currentIndex: 0,
      container: { data: [] },
      previousContainer: { data: [entry] },
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
    } as unknown as CdkDragDrop<PlaceTasksEntry[]>;

    // Drop into 'lunch' slot on a different date
    (component as unknown as { onDrop(e: CdkDragDrop<PlaceTasksEntry[]>, date: string, slotKey: string): void })
      .onDrop(dropEvent, '2026-04-29', 'lunch');

    const allWalks = component.entries().filter(e => e.title === 'Walk');
    expect(allWalks.length).toBe(1);
    expect(allWalks[0].scheduled_date).toBe('2026-04-29');
  });

  // ── Keyboard reorder: within-slot down ───────────────────────────────────────

  it('keyboard down reorders two entries within a slot', async () => {
    const { component, httpController, fixture } = setup(['First', 'Second'], PLAN_PERIOD, []);
    fixture.detectChanges();

    // Two unanchored fixed-time tasks in the same <sched> slot on the same date.
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([
      { title: 'First', scheduled_date: '2026-04-28', time_window_start: '09:00',
        task_type: 'general', duration_minutes: 15, energy_required: 'low' },
      { title: 'Second', scheduled_date: '2026-04-28', time_window_start: '10:00',
        task_type: 'general', duration_minutes: 15, energy_required: 'low' },
    ] as PlaceTasksEntry[]);
    fixture.detectChanges();

    const downs = fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'));
    downs[0].nativeElement.click();
    fixture.detectChanges();

    const titles = fixture.debugElement.queryAll(By.css('.task-title')).map(d => d.nativeElement.textContent.trim());
    expect(titles).toEqual(['Second', 'First']);

    expect(component.entries().map(e => e.title)).toEqual(['Second', 'First']);
  });

  // ── Keyboard reorder: into-meal cross-slot announcement ─────────────────────

  it('keyboard down into a meal section announces the meal label, not "undefined"', fakeAsync(() => {
    // Arrange: one task in the unanchored <sched> slot directly above the BREAKFAST
    // section. Pressing ↓ once crosses it into the meal section.
    // The day type mock provides BREAKFAST/LUNCH/DINNER sections for every day.
    const { httpController, fixture } = setup(['Meds'], PLAN_PERIOD, []);
    fixture.detectChanges();

    // One task with no anchor — sits in the <sched> slot (before BREAKFAST).
    const schedEntry: PlaceTasksEntry = {
      title: 'Meds',
      scheduled_date: '2026-04-28',
      task_type: 'general',
      duration_minutes: 5,
      energy_required: 'low',
    };
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([schedEntry]);
    fixture.detectChanges();
    tick(10000);

    // Spy on LiveAnnouncer.announce AFTER the TestBed is set up.
    const announcer = TestBed.inject(LiveAnnouncer);
    const announceSpy = vi.spyOn(announcer, 'announce');

    // Click the ↓ button for the Meds task — this crosses from <sched> into BREAKFAST.
    const downBtns = fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'));
    expect(downBtns.length).toBeGreaterThan(0);
    downBtns[0].nativeElement.click();
    fixture.detectChanges();

    // The announcement must name the destination meal section, not "undefined".
    expect(announceSpy).toHaveBeenCalled();
    const announced: string = announceSpy.mock.calls[0][0] as string;
    expect(announced).not.toContain('undefined');
    // The destination is BREAKFAST (mealLabel from the DaySection).
    expect(announced.toLowerCase()).toContain('breakfast');
    expect(announced).toMatch(/moved into/i);
  }));

  // ── Keyboard day-jump: next day ──────────────────────────────────────────────

  it('next-day jump moves an entry to the following date in the unanchored slot', async () => {
    const { component, httpController, fixture } = setup(['Solo'], PLAN_PERIOD, []);
    fixture.detectChanges();

    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([
      { title: 'Solo', scheduled_date: '2026-04-28', time_window_start: '09:00',
        task_type: 'general', duration_minutes: 15, energy_required: 'low' },
    ] as PlaceTasksEntry[]);
    fixture.detectChanges();

    fixture.debugElement.queryAll(By.css('[data-testid="reorder-next-day"]'))[0].nativeElement.click();
    fixture.detectChanges();

    const entry = component.entries()[0];
    expect(entry.scheduled_date).toBe('2026-04-29');
  });

});

// ── Helper-function tests ─────────────────────────────────────────────────────

describe('bucketOf', () => {
  function entry(overrides: Partial<PlaceTasksEntry>): PlaceTasksEntry {
    return {
      title: 'task',
      scheduled_date: '2026-04-28',
      duration_minutes: 30,
      energy_required: 'low',
      task_type: 'general',
      ...overrides,
    };
  }

  it('buckets after_anchor "start of day" as start-of-day', () => {
    expect(bucketOf(entry({ after_anchor: 'start of day' }), new Set())).toBe('start-of-day');
  });

  it('is case-insensitive for "start of day"', () => {
    expect(bucketOf(entry({ after_anchor: 'Start Of Day' }), new Set())).toBe('start-of-day');
    expect(bucketOf(entry({ after_anchor: 'START OF DAY' }), new Set())).toBe('start-of-day');
  });

  it('still buckets meal anchors as before (regression)', () => {
    const anchors = new Set(['breakfast', 'lunch', 'dinner']);
    expect(bucketOf(entry({ after_anchor: 'breakfast' }), anchors)).toBe('morning');
    expect(bucketOf(entry({ after_anchor: 'lunch' }), anchors)).toBe('afternoon');
    expect(bucketOf(entry({ after_anchor: 'dinner' }), anchors)).toBe('evening');
  });
});

describe('buildDayCards start-of-day rendering', () => {
  function meal(overrides: Partial<MealPatternEntry>): MealPatternEntry {
    return {
      id: 'm-1',
      day_type_id: 'd-1',
      user_id: 'u-1' as unknown as MealPatternEntry['user_id'],
      name: 'breakfast',
      preferred_time: '08:00:00',
      tolerance_minutes: 30,
      sort_order: 1,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
      ...overrides,
    } as MealPatternEntry;
  }

  function entry(overrides: Partial<PlaceTasksEntry>): PlaceTasksEntry {
    return {
      title: 'task',
      scheduled_date: '2026-04-28',
      duration_minutes: 30,
      energy_required: 'low',
      task_type: 'general',
      ...overrides,
    };
  }

  it('renders a start-of-day task above the first meal divider', () => {
    const entries: PlaceTasksEntry[] = [
      entry({ title: 'Walk', after_anchor: 'start of day' }),
      entry({ title: 'Meds', after_anchor: 'breakfast' }),
    ];
    const meals = [meal({ name: 'breakfast', preferred_time: '08:00:00', sort_order: 1 })];
    const cards = buildDayCards(entries, '2026-04-28', '2026-04-28', () => meals);
    const rows = cards[0].rows;

    const walkIdx = rows.findIndex(r => r.kind === 'task' && r.entry.title === 'Walk');
    const breakfastDividerIdx = rows.findIndex(r => r.kind === 'meal' && r.label === 'BREAKFAST');
    const medsIdx = rows.findIndex(r => r.kind === 'task' && r.entry.title === 'Meds');

    expect(walkIdx).toBeGreaterThanOrEqual(0);
    expect(breakfastDividerIdx).toBeGreaterThan(walkIdx);
    expect(medsIdx).toBeGreaterThan(breakfastDividerIdx);
  });

  it('includes start-of-day tasks in the flat fallback when meal pattern is empty', () => {
    const entries: PlaceTasksEntry[] = [
      entry({ title: 'Walk', after_anchor: 'start of day' }),
      entry({ title: 'Lunch errand', after_anchor: 'lunch' }), // no meal pattern → falls through to time bucket
    ];
    const cards = buildDayCards(entries, '2026-04-28', '2026-04-28', () => []);
    const rows = cards[0].rows;
    // No meal dividers when pattern is empty.
    expect(rows.every(r => r.kind === 'task')).toBe(true);
    // The start-of-day task is included.
    expect(rows.find(r => r.kind === 'task' && r.entry.title === 'Walk')).toBeDefined();
  });
});

describe('buildDaySections anchor matching', () => {
  function meal(name: string, sortOrder: number): MealPatternEntry {
    return {
      id: `m-${sortOrder}`,
      day_type_id: 'd-1',
      user_id: 'u-1' as unknown as MealPatternEntry['user_id'],
      name,
      preferred_time: '08:00:00',
      tolerance_minutes: 30,
      sort_order: sortOrder,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    } as MealPatternEntry;
  }

  function entry(overrides: Partial<PlaceTasksEntry>): PlaceTasksEntry {
    return {
      title: 'task',
      scheduled_date: '2026-04-28',
      duration_minutes: 30,
      energy_required: 'low',
      task_type: 'general',
      ...overrides,
    };
  }

  function sectionFor(sections: ReturnType<typeof buildDaySections>, slotKey: string) {
    return sections.find(s => s.slotKey === slotKey);
  }

  // Default onboarding meal names are Capitalized ('Breakfast'/'Lunch'/'Dinner'),
  // and the place_tasks agent echoes that casing verbatim into `after_anchor`
  // (per place_tasks.md: "exactly as it appears in [Anchors]"). The matcher must
  // be case-insensitive or every meal task falls through to the unanchored
  // '<sched>' section, which renders above the first divider (the "pre-breakfast"
  // slot). Regression guard for the case-sensitivity bug introduced in #991.
  it('places a capitalized after_anchor task in its meal section, not <sched>', () => {
    const pattern = [meal('Breakfast', 1), meal('Lunch', 2), meal('Dinner', 3)];
    const entries = [entry({ title: 'Meds', after_anchor: 'Breakfast' })];

    const sections = buildDaySections('2026-04-28', entries, pattern);

    expect(sectionFor(sections, 'breakfast')?.taskRows.map(r => r.entry.title)).toEqual(['Meds']);
    expect(sectionFor(sections, '<sched>')?.taskRows).toEqual([]);
  });

  it('matches anchor casing that differs from the stored meal name', () => {
    const pattern = [meal('Breakfast', 1), meal('Lunch', 2), meal('Dinner', 3)];
    const entries = [
      entry({ title: 'Walk', after_anchor: 'lunch' }),   // lowercase anchor, Capitalized meal
      entry({ title: 'Read', after_anchor: 'DINNER' }),  // uppercase anchor, Capitalized meal
    ];

    const sections = buildDaySections('2026-04-28', entries, pattern);

    expect(sectionFor(sections, 'lunch')?.taskRows.map(r => r.entry.title)).toEqual(['Walk']);
    expect(sectionFor(sections, 'dinner')?.taskRows.map(r => r.entry.title)).toEqual(['Read']);
    expect(sectionFor(sections, '<sched>')?.taskRows).toEqual([]);
  });

  it('keeps genuinely unanchored / fixed-time tasks in the <sched> section', () => {
    const pattern = [meal('Breakfast', 1)];
    const entries = [entry({ title: 'Call', time_window_start: '14:00' })];

    const sections = buildDaySections('2026-04-28', entries, pattern);

    expect(sectionFor(sections, '<sched>')?.taskRows.map(r => r.entry.title)).toEqual(['Call']);
    expect(sectionFor(sections, 'breakfast')?.taskRows).toEqual([]);
  });
});

