import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ScheduleService } from './schedule.service';
import { isMealAnchor, MealAnchor, ScheduleItem, ScheduleTask } from '../models/schedule';
import { ConfigService } from './config.service';
import { WritableSignal } from '@angular/core';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };

const EMPTY_PERIOD = { entries: [], carryover: [] };
const EMPTY_ANCHORS: unknown[] = [];

/** Flush both /schedule/period and /schedule/anchors for a loadDay call. */
function flushDay(
  httpMock: HttpTestingController,
  entries: unknown[] = [],
  anchors: unknown[] = [],
): void {
  httpMock.expectOne(r => r.url.includes('/schedule/period'))
    .flush({ entries, carryover: [] });
  httpMock.expectOne(r => r.url.includes('/schedule/anchors'))
    .flush(anchors);
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
      scheduled_start: '2026-04-02T07:00:00Z',
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

  it('maps a meal anchor instance to MealAnchor with MEAL_SLOTS name and emoji', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [{
      id: 'm1', user_id: 'u1', date: '2026-04-02',
      name: 'breakfast', preferred_time: '08:00:00',
      tolerance_minutes: 60, sort_order: 0, template_entry_id: null,
      created_at: '2026-04-02T08:00:00Z', updated_at: '2026-04-02T08:00:00Z',
    }]);

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    expect(isMealAnchor(items[0])).toBeTrue();
    const meal = items[0] as MealAnchor;
    expect(meal.id).toBe('m1');
    expect(meal.name).toBe('Breakfast');
    expect(meal.emoji).toBe('🥣');
    expect(meal.status).toBe('unplanned');
  });

  it('maps a custom meal anchor by its name field', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [{
      id: 'm9', user_id: 'u1', date: '2026-04-02',
      name: 'Brunch', preferred_time: '10:30:00',
      tolerance_minutes: 60, sort_order: 0, template_entry_id: null,
      created_at: '2026-04-02T10:30:00Z', updated_at: '2026-04-02T10:30:00Z',
    }]);

    const items = svc.scheduleItems();
    const meal = items[0] as MealAnchor;
    expect(meal.name).toBe('Brunch');
    expect(meal.emoji).toBe('🍴');
  });

  it('places anchor items before task items in scheduleItems', () => {
    svc.loadDay('2026-04-02');
    flushDay(
      httpMock,
      [{
        entry_id: 't1', task_type: 'exercise', title: 'Run',
        status: 'planned', date: '2026-04-02', scheduled_start: '2026-04-02T07:00:00Z',
      }],
      [{
        id: 'm1', user_id: 'u1', date: '2026-04-02',
        name: 'breakfast', preferred_time: '08:00:00',
        tolerance_minutes: 60, sort_order: 0, template_entry_id: null,
        created_at: '2026-04-02T08:00:00Z', updated_at: '2026-04-02T08:00:00Z',
      }],
    );

    const items = svc.scheduleItems();
    expect(items.length).toBe(2);
    expect(isMealAnchor(items[0])).toBeTrue();
    expect(isMealAnchor(items[1])).toBeFalse();
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
      scheduled_start: '2026-04-02T10:00:00Z',
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
    flushDay(httpMock);
    // Manually inject a MealAnchor with a duringMealTask to test toggle logic
    (svc as unknown as { _items: WritableSignal<ScheduleItem[]> })._items.set([{
      id: 'm1', name: 'Breakfast', emoji: '🥣',
      status: 'planned', duringMealTasks: [
        { id: 't-dm2', type: 'general', label: 'Read 10 pages', status: 'pending' }
      ]
    }]);
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

  it('addItem appends a ScheduleTask to scheduleItems', () => {
    const task: ScheduleTask = { id: 'new-1', type: 'general', label: 'call mum', status: 'pending' };
    svc.addItem(task);
    expect(svc.scheduleItems()).toContain(task);
    expect(svc.scheduleItems().length).toBe(1);
  });

  describe('skipMeal', () => {
    beforeEach(() => {
      (svc as unknown as { _items: WritableSignal<ScheduleItem[]> })._items.set([{
        id: 'meal-1', name: 'Lunch', emoji: '🥗',
        status: 'planned', duringMealTasks: [],
      }]);
    });

    it('immediately sets the meal status to skipped in the signal', () => {
      svc.skipMeal('meal-1');
      httpMock.expectOne(r => r.url.includes('/schedule/entries/meal-1/status')).flush(null);

      const meal = svc.scheduleItems()[0] as MealAnchor;
      expect(meal.status).toBe('skipped');
    });

    it('issues PATCH /schedule/entries/:id/status with body { status: skipped }', () => {
      svc.skipMeal('meal-1');

      const req = httpMock.expectOne('http://localhost:3000/schedule/entries/meal-1/status');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'skipped' });
      req.flush(null);
    });

    it('reloads the day on HTTP error to restore server state', () => {
      svc['_date'].set('2026-04-20');
      svc.skipMeal('meal-1');

      const patchReq = httpMock.expectOne(r => r.url.includes('/schedule/entries/meal-1/status'));
      patchReq.flush('error', { status: 500, statusText: 'Internal Server Error' });

      // Reload issues both requests
      flushDay(httpMock);
    });
  });
});
