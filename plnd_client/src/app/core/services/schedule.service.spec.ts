import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ScheduleService } from './schedule.service';
import { isMealAnchor, MealAnchor, ScheduleTask } from '../models/schedule';
import { ConfigService } from './config.service';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };

const EMPTY_PERIOD = { entries: [], carryover: [] };
const EMPTY_ANCHORS: unknown[] = [];

/** Flush both /schedule/period and /schedule/anchors for a loadDay call. */
function flushDay(
  httpMock: HttpTestingController,
  entries: unknown[] = [],
  anchors: unknown[] = [],
  plannedMeals: unknown[] = [],
): void {
  httpMock.expectOne(r => r.url.includes('/schedule/period'))
    .flush({ entries, carryover: [], planned_meals: plannedMeals });
  httpMock.expectOne(r => r.url.includes('/schedule/anchors'))
    .flush(anchors);
}

/** A unified meal-kind ScheduleAnchorDto with sensible defaults (#958). */
function anchorDto(id: string, name: string, date = '2026-04-02'): Record<string, unknown> {
  return {
    kind: 'meal', sequence: 0, time: '08:00:00', label: name, id,
    status: 'planned', consumed_at: null,
    tolerance_minutes: 60, sort_order: 0, template_entry_id: null,
    zone: null,
    // legacy fields harmlessly ignored by the unified mapper:
    user_id: 'u1', date, name, preferred_time: '08:00:00',
    created_at: `${date}T08:00:00Z`, updated_at: `${date}T08:00:00Z`,
  };
}

describe('ScheduleService', () => {
  let svc: ScheduleService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => MOCK_CONFIG } },
      ],
    });
    svc = TestBed.inject(ScheduleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('starts with empty items and not loading', () => {
    expect(svc.scheduleItems()).toEqual([]);
    expect(svc.isLoading()).toBeFalse();
  });

  it('loadDay sets isLoading then clears it after response', () => {
    svc.loadDay('2026-04-02');
    expect(svc.isLoading()).toBeTrue();

    flushDay(httpMock);

    expect(svc.isLoading()).toBeFalse();
  });

  it('loadDay GETs /schedule/period with start and end both set to the date', () => {
    svc.loadDay('2026-04-02');

    const req = httpMock.expectOne(r => r.url.includes('/schedule/period'));
    expect(req.request.params.get('start')).toBe('2026-04-02');
    expect(req.request.params.get('end')).toBe('2026-04-02');
    req.flush(EMPTY_PERIOD);
    httpMock.expectOne(r => r.url.includes('/schedule/anchors')).flush(EMPTY_ANCHORS);
  });

  it('loadDay GETs /schedule/anchors with the date param', () => {
    svc.loadDay('2026-04-02');

    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush(EMPTY_PERIOD);
    const req = httpMock.expectOne(r => r.url.includes('/schedule/anchors'));
    expect(req.request.params.get('date')).toBe('2026-04-02');
    req.flush(EMPTY_ANCHORS);
  });

  it('ignores non-meal anchors when mapping the day (kind filter)', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [], carryover: [], planned_meals: [],
    });
    httpMock.expectOne(r => r.url.includes('/schedule/anchors')).flush([
      { kind: 'start_of_day', sequence: 0, time: '07:00:00', label: 'start of day',
        id: null, status: null, consumed_at: null, tolerance_minutes: null,
        sort_order: null, template_entry_id: null, zone: null },
      anchorDto('meal-1', 'breakfast'),
      { kind: 'end_of_day', sequence: 2, time: '22:00:00', label: 'end of day',
        id: null, status: null, consumed_at: null, tolerance_minutes: null,
        sort_order: null, template_entry_id: null, zone: null },
    ]);
    // Only the single meal anchor renders as an item row.
    expect(svc.scheduleItems().length).toBe(1);
    expect(svc.scheduleItems()[0].id).toBe('meal-1');
  });

  it('loadDay records the requested date', () => {
    svc.loadDay('2026-04-01');
    flushDay(httpMock);
    expect(svc.date()).toBe('2026-04-01');
  });

  it('maps a task entry to ScheduleTask', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e1',
      task_type: 'exercise',
      title: 'Morning run',
      status: 'completed',
      date: '2026-04-02',
      scheduled_start: '07:00',
    }]);

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    const task = items[0] as ScheduleTask;
    expect(task.id).toBe('e1');
    expect(task.type).toBe('exercise');
    expect(task.label).toBe('Morning run');
    expect(task.status).toBe('done');
  });

  it('maps task_type work to ItemType work', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-work', task_type: 'work', title: 'Write report',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);
    expect((svc.scheduleItems()[0] as ScheduleTask).type).toBe('work');
  });

  it('maps task_type leisure to ItemType leisure', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-lei', task_type: 'leisure', title: 'Read novel',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);
    expect((svc.scheduleItems()[0] as ScheduleTask).type).toBe('leisure');
  });

  it('maps task_type medication to ItemType medication', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-med', task_type: 'medication', title: 'Take vitamins',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);
    expect((svc.scheduleItems()[0] as ScheduleTask).type).toBe('medication');
  });

  it('maps unknown task_type to ItemType general', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-unk', task_type: 'unknown_future_type', title: 'Something new',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);
    expect((svc.scheduleItems()[0] as ScheduleTask).type).toBe('general');
  });

  it('uses task_type as label when title is absent', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-notitle',
      task_type: 'exercise',
      status: 'planned',
      date: '2026-04-02',
      scheduled_start: null,
    }]);

    const task = svc.scheduleItems()[0] as ScheduleTask;
    expect(task.label).toBe('exercise');
  });

  it('marks a task floating when it has no time but is anchored to a meal slot', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-float', task_type: 'general', title: 'Stretch',
      status: 'planned', date: '2026-04-02', scheduled_start: null, after_anchor: 'lunch',
    }]);
    expect((svc.scheduleItems()[0] as ScheduleTask).floating).toBeTrue();
  });

  it('does not mark a task floating when it has neither a time nor an anchor', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-unscheduled', task_type: 'general', title: 'Errand',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);
    expect((svc.scheduleItems()[0] as ScheduleTask).floating).toBeFalse();
  });

  it('maps a meal anchor instance to MealAnchor with MEAL_SLOTS name and emoji', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [anchorDto('m1', 'breakfast')]);

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    expect(isMealAnchor(items[0])).toBeTrue();
    const meal = items[0] as MealAnchor;
    expect(meal.id).toBe('m1');
    expect(meal.name).toBe('Breakfast');
    expect(meal.emoji).toBe('🥣');
    expect(meal.status).toBe('unplanned');
  });

  it('maps a custom meal anchor by its label field', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [anchorDto('m9', 'Brunch')]);

    const items = svc.scheduleItems();
    const meal = items[0] as MealAnchor;
    expect(meal.name).toBe('Brunch');
    expect(meal.emoji).toBe('🍴');
  });

  it('joins a persisted planned meal into its anchor by meal_anchor_instance_id', () => {
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [],
      [anchorDto('m1', 'breakfast')],
      [{
        meal_entry_id: 'pm1', meal_anchor_instance_id: 'm1',
        meal_ref_id: 'dish-7', meal_ref_type: 'catalog_dish',
        title: 'Avocado toast + eggs', anchor_date: '2026-04-02', anchor_name: 'breakfast',
      }],
    );

    const meal = svc.scheduleItems()[0] as MealAnchor;
    expect(meal.status).toBe('planned');
    expect(meal.description).toBe('Avocado toast + eggs');
  });

  it('leaves an anchor unplanned when no planned meal references it', () => {
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [],
      [anchorDto('m1', 'breakfast'), anchorDto('m2', 'lunch')],
      [{
        meal_entry_id: 'pm1', meal_anchor_instance_id: 'm1',
        meal_ref_id: 'dish-7', meal_ref_type: 'catalog_dish',
        title: 'Avocado toast + eggs', anchor_date: '2026-04-02', anchor_name: 'breakfast',
      }],
    );

    const lunch = svc.scheduleItems()[1] as MealAnchor;
    expect(lunch.status).toBe('unplanned');
    expect(lunch.description).toBeUndefined();
  });

  it('places anchor items before task items in scheduleItems (via after_anchor)', () => {
    // A floating task (after_anchor: 'breakfast') slots immediately after its meal anchor.
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [{
        entry_id: 't1', task_type: 'exercise', title: 'Run',
        status: 'planned', date: '2026-04-02', scheduled_start: null, after_anchor: 'breakfast',
      }],
      [anchorDto('m1', 'breakfast')],
    );

    const items = svc.scheduleItems();
    expect(items.length).toBe(2);
    expect(isMealAnchor(items[0])).toBeTrue();   // meal anchor first
    expect(isMealAnchor(items[1])).toBeFalse(); // floating task immediately after
  });

  it('nests an entry linked by slot_meal_anchor_id into its anchor as a during-meal task', () => {
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [{
        entry_id: 'dt1', task_type: 'medication', title: 'Vitamins',
        status: 'planned', date: '2026-04-02', scheduled_start: null,
        after_anchor: 'breakfast', slot_meal_anchor_id: 'm1',
      }],
      [anchorDto('m1', 'breakfast')],
    );

    const items = svc.scheduleItems();
    // The paired task renders inside the meal, not as a top-level row.
    expect(items.length).toBe(1);
    const meal = items[0] as MealAnchor;
    expect(meal.duringMealTasks.length).toBe(1);
    expect(meal.duringMealTasks[0].id).toBe('dt1');
    expect(meal.duringMealTasks[0].label).toBe('Vitamins');
  });

  it('keeps an entry top-level when its slot_meal_anchor_id matches no anchor in the period', () => {
    // Orphan tasks (slot_meal_anchor_id references a missing anchor) surface at the
    // front of the list (before the slot-walk output) rather than being silently dropped.
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [{
        entry_id: 'orphan', task_type: 'general', title: 'Stray',
        status: 'planned', date: '2026-04-02', scheduled_start: null,
        slot_meal_anchor_id: 'no-such-anchor',
      }],
      [anchorDto('m1', 'breakfast')],
    );

    const items = svc.scheduleItems();
    expect(items.length).toBe(2);
    // orphan is leftover → surfaces before slot-walk output
    expect((items[0] as ScheduleTask).id).toBe('orphan');
    const meal = items[1] as MealAnchor;
    expect(meal.duringMealTasks.length).toBe(0);
  });

  it('separates paired and standalone entries by slot_meal_anchor_id', () => {
    // dt1 is paired to the meal via slot_meal_anchor_id → inside duringMealTasks.
    // std has no after_anchor and no matching scheduled_task anchor → leftover (front).
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [
        { entry_id: 'dt1', task_type: 'medication', title: 'Vitamins',
          status: 'planned', date: '2026-04-02', scheduled_start: null, slot_meal_anchor_id: 'm1' },
        { entry_id: 'std', task_type: 'work', title: 'Standalone',
          status: 'planned', date: '2026-04-02', scheduled_start: '09:00' },
      ],
      [anchorDto('m1', 'breakfast')],
    );

    const items = svc.scheduleItems();
    expect(items.length).toBe(2);
    // leftover (no matching anchor) surfaces before the slot walk
    expect((items[0] as ScheduleTask).id).toBe('std');
    // meal anchor with dt1 nested inside
    expect((items[1] as MealAnchor).duringMealTasks.map(t => t.id)).toEqual(['dt1']);
  });

  it('sets items to [] and clears loading on HTTP error in period', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush('server error', { status: 500, statusText: 'Internal Server Error' });
    httpMock.expectOne(r => r.url.includes('/schedule/anchors')).flush(EMPTY_ANCHORS);

    expect(svc.isLoading()).toBeFalse();
    expect(svc.scheduleItems()).toEqual([]);
  });

  it('calling loadDay a second time does not leave isLoading stuck when first request is superseded', () => {
    svc.loadDay('2026-04-01');
    svc.loadDay('2026-04-02');

    // switchMap cancels the first forkJoin (both period + anchors for 04-01)
    const periodReqs = httpMock.match(r => r.url.includes('/schedule/period'));
    expect(periodReqs.length).toBe(2);
    expect(periodReqs[0].cancelled).toBeTrue();
    periodReqs[1].flush(EMPTY_PERIOD);

    const anchorReqs = httpMock.match(r => r.url.includes('/schedule/anchors'));
    expect(anchorReqs.length).toBe(2);
    expect(anchorReqs[0].cancelled).toBeTrue();
    anchorReqs[1].flush(EMPTY_ANCHORS);

    expect(svc.isLoading()).toBeFalse();
    expect(svc.date()).toBe('2026-04-02');
  });

  it('isLoading is cleared even when the second request errors after the first was superseded', () => {
    svc.loadDay('2026-04-01');
    svc.loadDay('2026-04-02');

    const periodReqs = httpMock.match(r => r.url.includes('/schedule/period'));
    expect(periodReqs[0].cancelled).toBeTrue();
    periodReqs[1].flush('server error', { status: 500, statusText: 'Internal Server Error' });

    const anchorReqs = httpMock.match(r => r.url.includes('/schedule/anchors'));
    expect(anchorReqs[0].cancelled).toBeTrue();
    anchorReqs[1].flush(EMPTY_ANCHORS);

    expect(svc.isLoading()).toBeFalse();
    expect(svc.loadError()).toBe('Failed to load schedule');
  });

  it('toggleItem flips a task from pending to done', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 't3',
      task_type: 'general',
      title: 'Reply to dentist email',
      status: 'planned',
      date: '2026-04-02',
      scheduled_start: '10:00',
    }]);
    const task = svc.scheduleItems()[0] as ScheduleTask;
    expect(task.status).toBe('pending');
    svc.toggleItem('t3');
    httpMock.expectOne(r => r.url.includes('/schedule/entries/t3/status'))
      .flush(null, { status: 204, statusText: 'No Content' });
    expect((svc.scheduleItems()[0] as ScheduleTask).status).toBe('done');
  });

  it('toggleItem flips a during-meal task', () => {
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [{ entry_id: 't-dm2', task_type: 'general', title: 'Read 10 pages',
         status: 'planned', date: '2026-04-02', slot_meal_anchor_id: 'm1' }],
      [anchorDto('m1', 'breakfast')],
    );
    svc.toggleItem('t-dm2');
    httpMock.expectOne(r => r.url.includes('/schedule/entries/t-dm2/status'))
      .flush(null, { status: 204, statusText: 'No Content' });
    const meal = svc.scheduleItems()[0] as MealAnchor;
    expect(meal.duringMealTasks[0].status).toBe('done');
  });

  it('toggleItem PATCHes /schedule/entries/:id/status with completed when flipping pending to done', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'tp1', task_type: 'general', title: 'Stretch',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);

    svc.toggleItem('tp1');

    const req = httpMock.expectOne('http://localhost:3000/schedule/entries/tp1/status');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'completed' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('toggleItem PATCHes with planned when flipping done to pending', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'tp2', task_type: 'general', title: 'Stretch',
      status: 'completed', date: '2026-04-02', scheduled_start: null,
    }]);

    svc.toggleItem('tp2');

    const req = httpMock.expectOne('http://localhost:3000/schedule/entries/tp2/status');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'planned' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('toggleItem reloads the day on PATCH error', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'tp3', task_type: 'general', title: 'Stretch',
      status: 'planned', date: '2026-04-02', scheduled_start: null,
    }]);

    svc.toggleItem('tp3');

    httpMock.expectOne(r => r.url.includes('/schedule/entries/tp3/status'))
      .flush('error', { status: 500, statusText: 'Internal Server Error' });

    // Reload issues both requests again
    flushDay(httpMock);
    expect(svc.date()).toBe('2026-04-02');
  });

  it('toggleItem does not issue a PATCH when id is not found', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock);

    svc.toggleItem('nonexistent-id');

    expect(httpMock.match(r => r.url.includes('/schedule/entries/')).length).toBe(0);
  });

  it('updateEntry optimistically patches the item and PATCHes the entry', () => {
    svc.loadDay('2026-06-13');
    flushDay(httpMock, [{
      entry_id: 'entry-1',
      task_type: 'general',
      title: 'Old',
      status: 'planned',
      date: '2026-06-13',
      scheduled_start: null,
    }]);

    svc.updateEntry('entry-1', { title: 'New title', oneShot: true });

    const item = svc.scheduleItems().find(i => i.id === 'entry-1') as ScheduleTask;
    expect(item.label).toBe('New title');
    expect(item.oneShot).toBeTrue();

    const req = httpMock.expectOne(r =>
      r.method === 'PATCH' && r.url.endsWith('/schedule/entries/entry-1'));
    expect(req.request.body).toEqual({ title: 'New title', one_shot: true });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('updateEntry reloads the day on PATCH error', () => {
    svc.loadDay('2026-06-13');
    flushDay(httpMock, [{
      entry_id: 'entry-1', task_type: 'general', title: 'Old',
      status: 'planned', date: '2026-06-13', scheduled_start: null,
    }]);

    svc.updateEntry('entry-1', { title: 'New title' });

    httpMock.expectOne(r => r.method === 'PATCH' && r.url.endsWith('/schedule/entries/entry-1'))
      .flush('error', { status: 500, statusText: 'Internal Server Error' });

    flushDay(httpMock);
    expect(svc.date()).toBe('2026-06-13');
  });

  it('updateEntry issues no PATCH for a meal-anchor id', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [anchorDto('meal-1', 'breakfast')]);

    svc.updateEntry('meal-1', { title: 'x' });

    expect(httpMock.match(r => r.url.endsWith('/schedule/entries/meal-1')).length).toBe(0);
  });

  it('updateEntry patches a during-meal task nested in a meal anchor', () => {
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [{ entry_id: 't-dm3', task_type: 'medication', title: 'Take pill',
         status: 'planned', date: '2026-04-02', slot_meal_anchor_id: 'm1' }],
      [anchorDto('m1', 'breakfast')],
    );

    svc.updateEntry('t-dm3', { oneShot: true });

    const req = httpMock.expectOne(r => r.method === 'PATCH' && r.url.endsWith('/schedule/entries/t-dm3'));
    expect(req.request.body).toEqual({ one_shot: true });
    req.flush(null, { status: 204, statusText: 'No Content' });

    const meal = svc.scheduleItems()[0] as MealAnchor;
    expect(meal.duringMealTasks[0].oneShot).toBe(true);
  });

  it('maps one_shot from the DTO onto the task', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e1',
      task_type: 'exercise',
      title: 'Morning run',
      status: 'planned',
      date: '2026-04-02',
      scheduled_start: null,
      one_shot: true,
    }]);
    const task = svc.scheduleItems().find(t => t.id === 'e1') as ScheduleTask;
    expect(task.oneShot).toBe(true);
  });

  it('defaults oneShot to false when one_shot is absent from the DTO', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e2',
      task_type: 'general',
      title: 'Stretch',
      status: 'planned',
      date: '2026-04-02',
      scheduled_start: null,
    }]);
    const task = svc.scheduleItems().find(t => t.id === 'e2') as ScheduleTask;
    expect(task.oneShot).toBe(false);
  });

  it('passes an HH:MM scheduled_start through mapEntry unchanged as scheduledStart', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [{
      entry_id: 'e-hhmm',
      task_type: 'general',
      title: 'Morning routine',
      status: 'planned',
      date: '2026-04-02',
      scheduled_start: '09:00',
    }]);
    const task = svc.scheduleItems().find(i => i.id === 'e-hhmm') as ScheduleTask;
    expect(task.scheduledStart).toBe('09:00');
  });

  it('maps a consumed anchor to status done', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [{ ...anchorDto('m1', 'breakfast'), status: 'consumed' }]);
    expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('done');
  });

  it('maps a skipped anchor to status skipped', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [{ ...anchorDto('m1', 'breakfast'), status: 'skipped' }]);
    expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('skipped');
  });

  describe('setMealConsumption', () => {
    beforeEach(() => {
      // Load a lunch anchor with a planned dish ('Soup') through the real path so
      // the meal derives a 'planned' (has-dish) UI status, not 'unplanned'.
      svc.loadDay('2026-04-02');
      flushDay(
        httpMock,
        [],
        [anchorDto('meal-1', 'lunch')],
        [{ meal_entry_id: 'pm1', meal_anchor_instance_id: 'meal-1', meal_ref_id: 'r1',
           meal_ref_type: 'user_dish', title: 'Soup', anchor_date: null, anchor_name: null }],
      );
    });

    it('PATCHes /schedule/anchors/:id/status with the given status', () => {
      svc.setMealConsumption('meal-1', 'skipped');
      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'skipped' });
      req.flush({});
    });

    it('optimistically sets skipped in the signal', () => {
      svc.setMealConsumption('meal-1', 'skipped');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status')).flush({});
      expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('skipped');
    });

    it('optimistically sets done when consumed', () => {
      svc.setMealConsumption('meal-1', 'consumed');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status')).flush({});
      expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('done');
    });

    it('reverts to planned (has dish) when set to planned', () => {
      svc.setMealConsumption('meal-1', 'planned');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status')).flush({});
      expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('planned');
    });

    it('reloads the day on HTTP error', () => {
      svc['_date'].set('2026-04-20');
      svc.setMealConsumption('meal-1', 'consumed');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status'))
        .flush('error', { status: 500, statusText: 'Internal Server Error' });
      flushDay(httpMock);
    });
  });

  it('interleaves a floating task into the slot after its meal anchor', () => {
    svc.loadDay('2026-04-02');
    const floating = {
      entry_id: 'f1', task_type: 'general', title: 'Walk dog', date: '2026-04-02',
      status: 'pending', after_anchor: 'Breakfast',
    };
    const bfast = anchorDto('meal-1', 'Breakfast');
    const lunch = anchorDto('meal-2', 'Lunch');
    lunch['sequence'] = 1;
    flushDay(httpMock, [floating], [bfast, lunch], []);

    const labels = svc.scheduleItems().map(i =>
      isMealAnchor(i) ? `meal:${i.name}` : `task:${(i as ScheduleTask).label}`);
    expect(labels).toEqual(['meal:Breakfast', 'task:Walk dog', 'meal:Lunch']);
  });

  describe('toggleMealConsumed', () => {
    it('marks consumed when the meal is not done', () => {
      svc.loadDay('2026-04-02');
      flushDay(httpMock, [], [anchorDto('meal-1', 'lunch')]);
      svc.toggleMealConsumed('meal-1');
      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.body).toEqual({ status: 'consumed' });
      req.flush({});
    });

    it('reverts to planned when the meal is done', () => {
      svc.loadDay('2026-04-02');
      flushDay(httpMock, [], [{ ...anchorDto('meal-1', 'lunch'), status: 'consumed' }]);
      svc.toggleMealConsumed('meal-1');
      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.body).toEqual({ status: 'planned' });
      req.flush({});
    });

    it('marks consumed when the meal is skipped', () => {
      svc.loadDay('2026-04-02');
      flushDay(httpMock, [], [{ ...anchorDto('meal-1', 'lunch'), status: 'skipped' }]);
      svc.toggleMealConsumed('meal-1');
      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.body).toEqual({ status: 'consumed' });
      req.flush({});
    });

    it('does not issue a PATCH when the meal id is not found', () => {
      svc.loadDay('2026-04-02');
      flushDay(httpMock);
      svc.toggleMealConsumed('nonexistent-id');
      expect(httpMock.match(r => r.url.includes('/schedule/anchors/')).length).toBe(0);
    });
  });

  // The raison d'être of #987: scheduleItems and slotGroups are two projections of
  // one raw payload. A single optimistic mutation must surface in BOTH with no
  // hand-sync — previously a forgotten dual-write would silently desync the day view.
  describe('single source of truth (#987)', () => {
    it('a toggle reflects in BOTH scheduleItems and slotGroups without manual sync', () => {
      svc.loadDay('2026-04-02');
      flushDay(
        httpMock,
        [{ entry_id: 'f1', task_type: 'general', title: 'Walk dog',
           status: 'planned', date: '2026-04-02', after_anchor: 'Breakfast' }],
        [anchorDto('meal-1', 'Breakfast')],
      );

      const slotTask = () => svc.slotGroups()
        .find(g => g.anchorLabel === 'breakfast')!.tasks.find(t => t.id === 'f1')!;

      expect((svc.scheduleItems().find(i => i.id === 'f1') as ScheduleTask).status).toBe('pending');
      expect(slotTask().status).toBe('pending');

      svc.toggleItem('f1');
      httpMock.expectOne(r => r.url.includes('/schedule/entries/f1/status'))
        .flush(null, { status: 204, statusText: 'No Content' });

      expect((svc.scheduleItems().find(i => i.id === 'f1') as ScheduleTask).status).toBe('done');
      expect(slotTask().status).toBe('done');
    });

    it('an edit reflects in BOTH scheduleItems and slotGroups without manual sync', () => {
      svc.loadDay('2026-04-02');
      flushDay(
        httpMock,
        [{ entry_id: 'f2', task_type: 'general', title: 'Old',
           status: 'planned', date: '2026-04-02', after_anchor: 'Breakfast' }],
        [anchorDto('meal-1', 'Breakfast')],
      );

      svc.updateEntry('f2', { title: 'New' });
      httpMock.expectOne(r => r.url.endsWith('/schedule/entries/f2'))
        .flush(null, { status: 204, statusText: 'No Content' });

      expect((svc.scheduleItems().find(i => i.id === 'f2') as ScheduleTask).label).toBe('New');
      const slotTask = svc.slotGroups()
        .find(g => g.anchorLabel === 'breakfast')!.tasks.find(t => t.id === 'f2')!;
      expect(slotTask.label).toBe('New');
    });
  });
});
