import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { DayViewComponent } from './day-view';
import { ScheduleService } from '../../core/services/schedule.service';
import { BriefingService } from '../../core/services/briefing.service';
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
    addItem:    jasmine.createSpy('addItem'),
  };
}

function makeBriefingServiceMock() {
  return {
    weather:        signal(null).asReadonly(),
    news:           signal(null).asReadonly(),
    yesterday:      signal(null).asReadonly(),
    weatherError:   signal(null).asReadonly(),
    newsError:      signal(null).asReadonly(),
    yesterdayError: signal(null).asReadonly(),
    load: jasmine.createSpy('load'),
  };
}

const TEST_DATE = '2026-03-20';
const mockActivatedRoute = { params: of({ date: TEST_DATE }) };

describe('DayViewComponent (schedule view)', () => {
  it('shows skeleton rows while loading', async () => {
    const svc = makeScheduleServiceMock({ isLoading: true });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    expect(f.debugElement.queryAll(By.css('.skeleton')).length).toBeGreaterThan(0);
  });

  it('shows error state when loadError is set', async () => {
    const svc = makeScheduleServiceMock({ loadError: 'Network error' });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain("Couldn't load");
  });

  it('shows empty state when no items', async () => {
    const svc = makeScheduleServiceMock({ scheduleItems: [] });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
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
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    expect(f.debugElement.query(By.css('app-meal-row'))).toBeTruthy();
    expect(f.debugElement.query(By.css('app-task-row'))).toBeTruthy();
  });

  it('calls loadDay with the route date param on init', async () => {
    const svc = makeScheduleServiceMock();
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    expect(svc.loadDay).toHaveBeenCalledWith(TEST_DATE);
  });
});

const now = new Date();
const TODAY_DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

describe('DayViewComponent (isToday wiring)', () => {
  async function setupWithDate(date: string) {
    const svc = makeScheduleServiceMock({ date });
    const briefing = makeBriefingServiceMock();
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: briefing },
        { provide: ActivatedRoute,   useValue: { params: of({ date }) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    return { f, briefing };
  }

  it('renders briefing-header and calls briefing.load() for today', async () => {
    const { f, briefing } = await setupWithDate(TODAY_DATE);
    expect(f.debugElement.query(By.css('app-briefing-header'))).toBeTruthy();
    expect(briefing.load).toHaveBeenCalled();
  });

  it('does not render briefing-header for a past date', async () => {
    const { f } = await setupWithDate('2026-01-01');
    expect(f.debugElement.query(By.css('app-briefing-header'))).toBeFalsy();
  });

  it('renders yesterday-snapshot for today', async () => {
    const { f } = await setupWithDate(TODAY_DATE);
    expect(f.debugElement.query(By.css('app-yesterday-snapshot'))).toBeTruthy();
  });

  it('does not render yesterday-snapshot for a future date', async () => {
    const { f } = await setupWithDate('2030-12-31');
    expect(f.debugElement.query(By.css('app-yesterday-snapshot'))).toBeFalsy();
  });
});

describe('DayViewComponent (onItemAdded)', () => {
  it('calls scheduleService.addItem with a ScheduleTask built from the AddedEntry', async () => {
    const items: ScheduleItem[] = [
      { id: 't1', type: 'task', label: 'Existing', status: 'pending' }
    ];
    const svc = makeScheduleServiceMock({ scheduleItems: items });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();

    f.componentInstance.onItemAdded({ label: 'call mum', type: 'task', id: 'srv-1' });

    expect(svc.addItem).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'srv-1', label: 'call mum', type: 'task', status: 'pending' }),
    );
  });
});
