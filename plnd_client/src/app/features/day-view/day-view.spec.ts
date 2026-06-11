import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
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
    loadDay:             jasmine.createSpy('loadDay'),
    toggleItem:          jasmine.createSpy('toggleItem'),
    toggleMealConsumed:  jasmine.createSpy('toggleMealConsumed'),
    setMealConsumption:  jasmine.createSpy('setMealConsumption'),
    addItem:             jasmine.createSpy('addItem'),
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
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        provideRouter([]),
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
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        provideRouter([]),
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
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        provideRouter([]),
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
      { id: 't1', type: 'general', label: '💊 Vitamins', status: 'pending' }
    ];
    const svc = makeScheduleServiceMock({ scheduleItems: items });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        provideRouter([]),
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
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        provideRouter([]),
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
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: briefing },
        provideRouter([]),
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
    expect(briefing.load).toHaveBeenCalledWith(TODAY_DATE);
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
  it('calls scheduleService.loadDay to reload after a task is added', async () => {
    const svc = makeScheduleServiceMock({ date: '2026-03-20' });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: makeBriefingServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute,   useValue: mockActivatedRoute },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    svc.loadDay.calls.reset(); // clear the init call

    f.componentInstance.onItemAdded({ label: 'call mum', type: 'general', id: 'srv-1' });

    expect(svc.loadDay).toHaveBeenCalledOnceWith('2026-03-20');
    expect(svc.addItem).not.toHaveBeenCalled();
  });
});

describe('DayViewComponent (toast)', () => {
  async function setupToast() {
    const svc = makeScheduleServiceMock();
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: makeBriefingServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute,   useValue: mockActivatedRoute },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    return f;
  }

  it('shows a toast when onTaskConfirmed is called', async () => {
    const f = await setupToast();
    f.componentInstance.onTaskConfirmed('Walk added for after lunch');
    f.detectChanges();
    const toast = f.debugElement.query(By.css('.toast'));
    expect(toast).toBeTruthy();
    expect(toast.nativeElement.textContent).toContain('Walk added for after lunch');
  });

  it('hides the toast after 5000ms', fakeAsync(async () => {
    const f = await setupToast();
    f.componentInstance.onTaskConfirmed('Walk added');
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeTruthy();

    tick(5000);
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeNull();
  }));

  it('replaces an in-flight toast when a second confirmation arrives', fakeAsync(async () => {
    const f = await setupToast();
    const inst = f.componentInstance;
    inst.onTaskConfirmed('First task added');
    f.detectChanges();

    tick(1000); // 1s into first toast's lifetime
    inst.onTaskConfirmed('Second task added');
    f.detectChanges();

    const toast = f.debugElement.query(By.css('.toast'));
    expect(toast.nativeElement.textContent).toContain('Second task added');

    tick(5000); // second toast's full lifetime expires
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeNull();
  }));

  it('hides the toast immediately when the close button is clicked', fakeAsync(async () => {
    const f = await setupToast();
    f.componentInstance.onTaskConfirmed('Walk added');
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeTruthy();

    f.debugElement.query(By.css('.toast-close')).nativeElement.click();
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeNull();

    // Timer should also be cleared — no pending macrotask
    tick(5000);
  }));
});
