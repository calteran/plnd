import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { DashboardComponent } from './dashboard';
import { ScheduleService } from '../../core/services/schedule.service';
import { ScheduleItem } from '../../core/models/schedule';
import { signal } from '@angular/core';

function makeScheduleServiceMock(overrides: Partial<{
  scheduleItems: ScheduleItem[];
  isLoading: boolean;
  loadError: string | null;
  date: string;
}> = {}) {
  const items   = signal(overrides.scheduleItems ?? []);
  const loading = signal(overrides.isLoading     ?? false);
  const error   = signal(overrides.loadError     ?? null);
  const date    = signal(overrides.date          ?? '2026-03-19');
  return {
    scheduleItems: items.asReadonly(),
    isLoading:     loading.asReadonly(),
    loadError:     error.asReadonly(),
    date:          date.asReadonly(),
    loadDay:    jasmine.createSpy('loadDay'),
    toggleItem: jasmine.createSpy('toggleItem'),
  };
}

describe('DashboardComponent (schedule view)', () => {
  it('shows skeleton rows while loading', async () => {
    const svc = makeScheduleServiceMock({ isLoading: true });
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [{ provide: ScheduleService, useValue: svc }]
    }).compileComponents();
    const f = TestBed.createComponent(DashboardComponent);
    f.detectChanges();
    expect(f.debugElement.queryAll(By.css('.skeleton')).length).toBeGreaterThan(0);
  });

  it('shows error state when loadError is set', async () => {
    const svc = makeScheduleServiceMock({ loadError: 'Network error' });
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [{ provide: ScheduleService, useValue: svc }]
    }).compileComponents();
    const f = TestBed.createComponent(DashboardComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain("Couldn't load");
  });

  it('shows empty state when no items', async () => {
    const svc = makeScheduleServiceMock({ scheduleItems: [] });
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [{ provide: ScheduleService, useValue: svc }]
    }).compileComponents();
    const f = TestBed.createComponent(DashboardComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Nothing planned yet');
  });

  it('renders meal and task rows when items are present', async () => {
    const items: ScheduleItem[] = [
      { id: 'm1', name: 'Breakfast', emoji: '🥑', status: 'done', duringMealTasks: [] },
      { id: 't1', type: 'task', label: '💊 Vitamins', status: 'pending' }
    ];
    const svc = makeScheduleServiceMock({ scheduleItems: items });
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [{ provide: ScheduleService, useValue: svc }]
    }).compileComponents();
    const f = TestBed.createComponent(DashboardComponent);
    f.detectChanges();
    expect(f.debugElement.query(By.css('app-meal-row'))).toBeTruthy();
    expect(f.debugElement.query(By.css('app-task-row'))).toBeTruthy();
  });

  it('calls loadDay with today on init', async () => {
    const svc = makeScheduleServiceMock();
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [{ provide: ScheduleService, useValue: svc }]
    }).compileComponents();
    const f = TestBed.createComponent(DashboardComponent);
    f.detectChanges();
    expect(svc.loadDay).toHaveBeenCalled();
  });
});
