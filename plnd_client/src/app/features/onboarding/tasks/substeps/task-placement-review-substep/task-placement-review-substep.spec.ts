import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { TaskPlacementReviewSubstepComponent, expandTemplatesToEntries } from './task-placement-review-substep';
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
    task_type: 'custom',
    title: 'Daily Routine',
    recurrence: 'daily',
    recurrence_rule: 'FREQ=DAILY',
    time_window_start: '08:00',
    time_window_end: null,
    duration_minutes: 30,
    energy_required: 'low',
    is_milepost: false,
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

  it('shows day-card grid without making an HTTP call when only routines exist', fakeAsync(async () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=DAILY' });
    const { fixture, component, stateMock, httpController, router } = await setup([], PLAN_PERIOD, [template]);
    fixture.detectChanges();

    // No HTTP request should be made — routines are display-only
    httpController.expectNone(`${API_BASE}/agent/place-tasks`);

    const dayCards = fixture.nativeElement.querySelectorAll('.day-card');
    expect(dayCards.length).toBe(3);
    const taskTitles: string[] = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('.task-title')
    ).map(el => el.textContent?.trim() ?? '');
    expect(taskTitles).toContain('Daily Routine');

    // Routine rows carry a "routine" badge, not an Edit button
    const routineBadges = fixture.nativeElement.querySelectorAll('.routine-badge');
    expect(routineBadges.length).toBeGreaterThan(0);

    // Save & Return must NOT include routine entries in placed_tasks
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();
    tick();

    expect(stateMock.setPlacedTasks).toHaveBeenCalledWith([]);
  }));

  // ── Routines + tasks (merged) ─────────────────────────────────────────────────

  it('shows both agent-placed tasks and routine previews in day cards', fakeAsync(async () => {
    const template = makeTemplate({ title: 'Medication', recurrence_rule: 'FREQ=DAILY' });
    const { fixture, component, stateMock, httpController, router } = await setup(
      ['Morning Walk'],
      PLAN_PERIOD,
      [template],
    );
    fixture.detectChanges();

    // Agent call is made for the task
    httpController.expectOne(`${API_BASE}/agent/place-tasks`).flush([MOCK_ENTRIES[0]]);
    fixture.detectChanges();

    const taskTitles: string[] = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('.task-title')
    ).map(el => el.textContent?.trim() ?? '');
    expect(taskTitles).toContain('Morning Walk');
    expect(taskTitles).toContain('Medication');

    // Routine rows show the routine badge, not an Edit button
    const routineBadges = fixture.nativeElement.querySelectorAll('.routine-badge');
    expect(routineBadges.length).toBeGreaterThan(0);

    // Save & Return must include only the task in placed_tasks, NOT routine entries
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    component.complete.subscribe(jasmine.createSpy('complete'));

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    saveBtn.click();
    fixture.detectChanges();
    tick();

    const placedArg: PlanEntryRequest[] = stateMock.setPlacedTasks.calls.first().args[0];
    expect(placedArg.length).toBe(1);
    expect(placedArg[0].title).toBe('Morning Walk');
  }));

});

// ── expandTemplatesToEntries (pure function — no Angular DI) ──────────────────

describe('expandTemplatesToEntries', () => {
  const START = '2026-04-28'; // Tuesday
  const END   = '2026-04-30'; // Thursday (3 days: Tue, Wed, Thu)

  it('returns empty array for empty templates', () => {
    expect(expandTemplatesToEntries([], START, END)).toEqual([]);
  });

  it('expands FREQ=DAILY to one entry per day in the plan period', () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=DAILY' });
    const result = expandTemplatesToEntries([template], START, END);
    expect(result.length).toBe(3);
    expect(result.map(e => e.scheduled_date)).toEqual(['2026-04-28', '2026-04-29', '2026-04-30']);
  });

  it('expands FREQ=WEEKLY;BYDAY=TU,TH to only matching weekdays', () => {
    // Apr 28=Tue, Apr 29=Wed, Apr 30=Thu → Tue and Thu match
    const template = makeTemplate({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU,TH' });
    const result = expandTemplatesToEntries([template], START, END);
    expect(result.length).toBe(2);
    expect(result.map(e => e.scheduled_date)).toEqual(['2026-04-28', '2026-04-30']);
  });

  it('skips FREQ=MONTHLY (no client expansion)', () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=MONTHLY' });
    expect(expandTemplatesToEntries([template], START, END)).toEqual([]);
  });

  it('skips FREQ=YEARLY (no client expansion)', () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=YEARLY' });
    expect(expandTemplatesToEntries([template], START, END)).toEqual([]);
  });

  it('skips bare FREQ=WEEKLY with no BYDAY', () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=WEEKLY' });
    expect(expandTemplatesToEntries([template], START, END)).toEqual([]);
  });

  it('expands FREQ=WEEKLY;INTERVAL=2;BYDAY=TU correctly despite extra RRULE params', () => {
    // INTERVAL=2 is not enforced client-side (backend handles it) but BYDAY must still be parsed
    const template = makeTemplate({ recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU' });
    const result = expandTemplatesToEntries([template], START, END);
    // Apr 28=Tue is in range; we only check that BYDAY was parsed and Tue matched
    expect(result.some(e => e.scheduled_date === '2026-04-28')).toBeTrue();
  });

  it('uses undefined time_window_start when template has none (lets slotOf default to afternoon)', () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=DAILY', time_window_start: null });
    const result = expandTemplatesToEntries([template], START, END);
    expect(result[0].time_window_start).toBeUndefined();
  });

  it('uses 30 as default duration_minutes when template has none', () => {
    const template = makeTemplate({ recurrence_rule: 'FREQ=DAILY', duration_minutes: null });
    const result = expandTemplatesToEntries([template], START, END);
    expect(result[0].duration_minutes).toBe(30);
  });

  it('maps template fields to PlaceTasksEntry correctly', () => {
    const template = makeTemplate({
      title: 'Meditation',
      task_type: 'custom',
      recurrence_rule: 'FREQ=DAILY',
      time_window_start: '07:00',
      duration_minutes: 20,
      energy_required: 'low',
    });
    const result = expandTemplatesToEntries([template], START, END);
    expect(result[0]).toEqual(jasmine.objectContaining({
      title: 'Meditation',
      task_type: 'custom',
      time_window_start: '07:00',
      duration_minutes: 20,
      energy_required: 'low',
    }));
  });
});
