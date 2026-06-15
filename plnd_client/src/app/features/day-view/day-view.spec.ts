import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DayViewComponent } from './day-view';
import { ScheduleService } from '../../core/services/schedule.service';
import { BriefingService } from '../../core/services/briefing.service';
import { TimezoneService } from '../../core/services/timezone.service';
import { ScheduleItem } from '../../core/models/schedule';
import { TimezoneAnchorDto } from '../../core/models/timezone';
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
    // Plain method (not a pre-installed spy) so individual tests can spyOn it.
    updateEntry(_id: string, _patch: unknown): void {
      // no-op stub; overridden per-test via spyOn
      return undefined;
    },
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

/** Build a minimal timezone service mock. Defaults to no anchors and a fixed device zone. */
function makeTimezoneServiceMock(overrides: {
  anchors?: TimezoneAnchorDto[];
  deviceZone?: string;
} = {}) {
  const anchors = overrides.anchors ?? [];
  const zone    = overrides.deviceZone ?? 'America/New_York';
  return {
    listAnchors: jasmine.createSpy('listAnchors').and.returnValue(of(anchors)),
    deviceZone:  jasmine.createSpy('deviceZone').and.returnValue(zone),
    createAnchor:  jasmine.createSpy('createAnchor').and.returnValue(of({})),
    deleteAnchor:  jasmine.createSpy('deleteAnchor').and.returnValue(of(undefined)),
    deleteGroup:   jasmine.createSpy('deleteGroup').and.returnValue(of({ deleted: 1 })),
    reportDeviceZone: jasmine.createSpy('reportDeviceZone').and.returnValue(of({})),
    resolve:          jasmine.createSpy('resolve').and.returnValue(of({ zone: null })),
    dismissStandoff:  jasmine.createSpy('dismissStandoff').and.returnValue(of(undefined)),
  };
}

function makeAnchor(overrides: Partial<TimezoneAnchorDto> = {}): TimezoneAnchorDto {
  return {
    id: 'anchor-1',
    user_id: 'user-1',
    effective_date: '2026-03-20',
    effective_time: null,
    zone: 'America/Denver',
    source: 'user',
    source_ref: null,
    inference_group: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
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
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
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
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
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
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
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
      { id: 't1', type: 'general', label: '💊 Vitamins', status: 'pending', oneShot: false, floating: false }
    ];
    const svc = makeScheduleServiceMock({ scheduleItems: items });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
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
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
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
        { provide: TimezoneService,  useValue: makeTimezoneServiceMock() },
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
        { provide: TimezoneService,  useValue: makeTimezoneServiceMock() },
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

describe('DayViewComponent (inline editor)', () => {
  async function setupEditor() {
    const svc = makeScheduleServiceMock();
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: makeBriefingServiceMock() },
        { provide: TimezoneService,  useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute,   useValue: mockActivatedRoute },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    return { f, component: f.componentInstance, svc };
  }

  it('opens one editor at a time and closes it', async () => {
    const { component } = await setupEditor();
    component.openEditor('entry-1');
    expect(component.editingId()).toBe('entry-1');
    component.openEditor('entry-2');
    expect(component.editingId()).toBe('entry-2');   // switches, does not stack
    component.closeEditor();
    expect(component.editingId()).toBeNull();
  });

  it('routes a save patch to ScheduleService.updateEntry', async () => {
    const { component } = await setupEditor();
    const spy = spyOn(component['scheduleService'], 'updateEntry');
    component.onEditSave('entry-1', { title: 'X' });
    expect(spy).toHaveBeenCalledWith('entry-1', { title: 'X' });
  });

  it('dims a row only while a different row is being edited', async () => {
    const { component } = await setupEditor();
    const task: ScheduleItem = { id: 't1', type: 'general', label: 'Task', status: 'pending', oneShot: false, floating: false };
    component.editingId.set(null);
    expect(component['isSpotlightDimmed'](task)).toBeFalse();      // nothing editing
    component.editingId.set('t1');
    expect(component['isSpotlightDimmed'](task)).toBeFalse();      // editing self
    component.editingId.set('other');
    expect(component['isSpotlightDimmed'](task)).toBeTrue();       // editing another row
  });

  it('keeps a meal row lit while one of its during-meal tasks is being edited', async () => {
    const { component } = await setupEditor();
    const meal: ScheduleItem = {
      id: 'm1', name: 'Breakfast', emoji: '🥑', status: 'planned',
      duringMealTasks: [
        { id: 'dt1', type: 'general', label: 'Vitamins', status: 'pending', oneShot: false, floating: false },
      ],
    };
    component.editingId.set('dt1');
    expect(component['isSpotlightDimmed'](meal)).toBeFalse();
    component.editingId.set('elsewhere');
    expect(component['isSpotlightDimmed'](meal)).toBeTrue();
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
        { provide: TimezoneService,  useValue: makeTimezoneServiceMock() },
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

// ── Timezone surfacing tests ──────────────────────────────────────────────────

describe('DayViewComponent (timezone: divergent day)', () => {
  const TRAVEL_DATE = '2026-01-15';

  it('calls tz.listAnchors for the loaded date', async () => {
    const tzSvc = makeTimezoneServiceMock();
    const svc   = makeScheduleServiceMock({ date: TRAVEL_DATE });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: tzSvc },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: TRAVEL_DATE }) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    expect(tzSvc.listAnchors).toHaveBeenCalledWith(TRAVEL_DATE);
  });

  it('sets zoneView to "divergent" when anchor zone differs from device zone', async () => {
    // Anchor zone: America/Denver. Device zone: America/New_York (different).
    // effective_date before the loaded date → governs the whole day as incoming zone.
    const anchors: TimezoneAnchorDto[] = [
      makeAnchor({ effective_date: '2026-01-01', zone: 'America/Denver', effective_time: null }),
    ];
    const tzSvc = makeTimezoneServiceMock({ anchors, deviceZone: 'America/New_York' });
    const svc   = makeScheduleServiceMock({ date: TRAVEL_DATE });

    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: tzSvc },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: TRAVEL_DATE }) } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();

    // zoneView signal should reflect divergent kind.
    expect(f.componentInstance.zoneView()?.kind).toBe('divergent');
    // Day header should receive the zoneView — the chip text should appear.
    const banner = f.debugElement.query(By.css('.tz-banner'));
    expect(banner).toBeTruthy();
  });

  it('does not break when timezone API errors', async () => {
    const tzSvc = makeTimezoneServiceMock();
    (tzSvc.listAnchors as jasmine.Spy).and.returnValue(throwError(() => new Error('network')));
    const svc = makeScheduleServiceMock();
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: tzSvc },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    // Should not throw; zoneView stays null.
    expect(() => f.detectChanges()).not.toThrow();
    expect(f.componentInstance.zoneView()).toBeNull();
  });
});

describe('DayViewComponent (timezone: travel day)', () => {
  const TRAVEL_DATE = '2026-06-20';

  it('renders app-timezone-switch-row when zoneView kind is "travel"', async () => {
    // Intra-day anchor on the travel date → classifyDay returns travel.
    const items: ScheduleItem[] = [
      { id: 't1', type: 'general', label: 'Flight', status: 'pending', oneShot: false, floating: false },
    ];
    const anchors: TimezoneAnchorDto[] = [
      makeAnchor({
        id: 'anchor-travel',
        effective_date: TRAVEL_DATE,
        effective_time: '14:00:00',  // intra-day → travel kind
        zone: 'Pacific/Honolulu',
      }),
    ];
    // Device zone differs from anchor zone; incoming zone = null (no prior anchor).
    const tzSvc = makeTimezoneServiceMock({ anchors, deviceZone: 'America/New_York' });
    const svc   = makeScheduleServiceMock({ scheduleItems: items, date: TRAVEL_DATE });

    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: tzSvc },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: TRAVEL_DATE }) } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();

    expect(f.componentInstance.zoneView()?.kind).toBe('travel');
    expect(f.debugElement.query(By.css('app-timezone-switch-row'))).toBeTruthy();
  });

  it('does not render app-timezone-switch-row when no anchors (same kind)', async () => {
    const items: ScheduleItem[] = [
      { id: 't1', type: 'general', label: 'Walk', status: 'pending', oneShot: false, floating: false },
    ];
    const tzSvc = makeTimezoneServiceMock({ anchors: [], deviceZone: 'America/New_York' });
    const svc   = makeScheduleServiceMock({ scheduleItems: items, date: TRAVEL_DATE });

    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: tzSvc },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: TRAVEL_DATE }) } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();

    expect(f.componentInstance.zoneView()?.kind).toBe('same');
    expect(f.debugElement.query(By.css('app-timezone-switch-row'))).toBeNull();
  });
});
