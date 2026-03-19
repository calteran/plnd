import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ScheduleService } from './schedule.service';

describe('ScheduleService', () => {
  let svc: ScheduleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ScheduleService);
  });

  it('starts with empty items and not loading', () => {
    expect(svc.scheduleItems()).toEqual([]);
    expect(svc.isLoading()).toBeFalse();
  });

  it('loadDay sets loading then resolves with items', fakeAsync(() => {
    svc.loadDay('2026-03-19');
    expect(svc.isLoading()).toBeTrue();
    tick(300);
    expect(svc.isLoading()).toBeFalse();
    expect(svc.scheduleItems().length).toBeGreaterThan(0);
  }));

  it('loadDay records the requested date', fakeAsync(() => {
    svc.loadDay('2026-04-01');
    tick(300);
    expect(svc.date()).toBe('2026-04-01');
  }));

  it('toggleItem flips a task from pending to done', fakeAsync(() => {
    svc.loadDay('2026-04-01');
    tick(300);
    const task = svc.scheduleItems().find(i => 't3' === i.id);
    expect(task).toBeTruthy();
    expect((task as any).status).toBe('pending');
    svc.toggleItem('t3');
    const updated = svc.scheduleItems().find(i => 't3' === i.id);
    expect((updated as any).status).toBe('done');
  }));

  it('toggleItem flips a during-meal task', fakeAsync(() => {
    svc.loadDay('2026-04-01');
    tick(300);
    svc.toggleItem('t-dm2');
    const meal = svc.scheduleItems().find(i => 'm1' === i.id) as any;
    const task = meal.duringMealTasks.find((t: any) => t.id === 't-dm2');
    expect(task.status).toBe('done');
  }));
});
