import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ScheduleService } from './schedule.service';
import { isMealAnchor, MealAnchor, ScheduleItem, ScheduleTask } from '../models/schedule';
import { ConfigService } from './config.service';
import { WritableSignal } from '@angular/core';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };

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

    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush({ entries: [], carryover: [] });

    expect(svc.isLoading()).toBeFalse();
  });

  it('loadDay GETs /schedule/period with start and end both set to the date', () => {
    svc.loadDay('2026-04-02');

    const req = httpMock.expectOne(r => r.url.includes('/schedule/period'));
    expect(req.request.params.get('start')).toBe('2026-04-02');
    expect(req.request.params.get('end')).toBe('2026-04-02');
    req.flush({ entries: [], carryover: [] });
  });

  it('loadDay records the requested date', () => {
    svc.loadDay('2026-04-01');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush({ entries: [], carryover: [] });
    expect(svc.date()).toBe('2026-04-01');
  });

  it('maps a task entry to ScheduleTask', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [{
        entry_id: 'e1',
        task_type: 'exercise',
        title: 'Morning run',
        status: 'completed',
        date: '2026-04-02',
        scheduled_start: '2026-04-02T07:00:00Z',
      }],
      carryover: [],
    });

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    const task = items[0] as ScheduleTask;
    expect(task.id).toBe('e1');
    expect(task.type).toBe('exercise');
    expect(task.label).toBe('Morning run');
    expect(task.status).toBe('done');
  });

  it('maps a meal entry to MealAnchor', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [{
        entry_id: 'm1',
        task_type: 'meal',
        title: null,
        after_anchor: 'breakfast',
        status: 'planned',
        date: '2026-04-02',
        scheduled_start: '2026-04-02T08:00:00Z',
      }],
      carryover: [],
    });

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    expect(isMealAnchor(items[0])).toBeTrue();
    const meal = items[0] as MealAnchor;
    expect(meal.name).toBe('Breakfast');
    expect(meal.status).toBe('planned');
  });

  it('sets items to [] and clears loading on HTTP error', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush('server error', { status: 500, statusText: 'Internal Server Error' });

    expect(svc.isLoading()).toBeFalse();
    expect(svc.scheduleItems()).toEqual([]);
  });

  it('calling loadDay a second time does not leave isLoading stuck when first request is superseded', () => {
    svc.loadDay('2026-04-01');
    svc.loadDay('2026-04-02');

    // switchMap cancels the first request at the HTTP level; only the second is flushable
    const reqs = httpMock.match(r => r.url.includes('/schedule/period'));
    expect(reqs.length).toBe(2);
    expect(reqs[0].cancelled).toBeTrue();
    reqs[1].flush({ entries: [], carryover: [] });

    expect(svc.isLoading()).toBeFalse();
    expect(svc.date()).toBe('2026-04-02');
  });

  it('isLoading is cleared even when the second request errors after the first was superseded', () => {
    svc.loadDay('2026-04-01');
    svc.loadDay('2026-04-02');

    const reqs = httpMock.match(r => r.url.includes('/schedule/period'));
    expect(reqs[0].cancelled).toBeTrue();
    reqs[1].flush('server error', { status: 500, statusText: 'Internal Server Error' });

    expect(svc.isLoading()).toBeFalse();
    expect(svc.loadError()).toBe('Failed to load schedule');
  });

  it('toggleItem flips a task from pending to done', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [{
        entry_id: 't3',
        task_type: 'general',
        title: 'Reply to dentist email',
        status: 'planned',
        date: '2026-04-02',
        scheduled_start: '2026-04-02T10:00:00Z',
      }],
      carryover: [],
    });
    const task = svc.scheduleItems()[0] as ScheduleTask;
    expect(task.status).toBe('pending');
    svc.toggleItem('t3');
    expect((svc.scheduleItems()[0] as ScheduleTask).status).toBe('done');
  });

  it('toggleItem flips a during-meal task', () => {
    // duringMealTasks come from within a MealAnchor — toggleItem must find nested tasks
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush({ entries: [], carryover: [] });
    // Manually inject a MealAnchor with a duringMealTask to test toggle logic
    (svc as unknown as { _items: WritableSignal<ScheduleItem[]> })._items.set([{
      id: 'm1', name: 'Breakfast', emoji: '🥣',
      status: 'planned', duringMealTasks: [
        { id: 't-dm2', type: 'task', label: 'Read 10 pages', status: 'pending' }
      ]
    }]);
    svc.toggleItem('t-dm2');
    const meal = svc.scheduleItems()[0] as MealAnchor;
    expect(meal.duringMealTasks[0].status).toBe('done');
  });

  it('addItem appends a ScheduleTask to scheduleItems', () => {
    const task: ScheduleTask = { id: 'new-1', type: 'task', label: 'call mum', status: 'pending' };
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

      const getReq = httpMock.expectOne(r => r.url.includes('/schedule/period'));
      expect(getReq.request.params.get('start')).toBe('2026-04-20');
      getReq.flush({ entries: [], carryover: [] });
    });
  });
});
