import { type Mock } from '../../../testing/spy';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { DayViewComponent } from './day-view';
import { ScheduleService } from '../../core/services/schedule.service';
import { BriefingService } from '../../core/services/briefing.service';
import { TimezoneService } from '../../core/services/timezone.service';
import { MealAnchor, ScheduleItem, ScheduleTask, SlotGroup } from '../../core/models/schedule';
import { TimezoneAnchorDto } from '../../core/models/timezone';
import { signal } from '@angular/core';

function makeScheduleServiceMock(overrides: Partial<{
  scheduleItems: ScheduleItem[];
  slotGroups: SlotGroup[];
  isLoading: boolean;
  loadError: string | null;
  date: string;
}> = {}) {
  const items      = signal(overrides.scheduleItems ?? []);
  const slotGroups = signal(overrides.slotGroups    ?? []);
  const loading    = signal(overrides.isLoading     ?? false);
  const error      = signal(overrides.loadError     ?? null);
  const date       = signal(overrides.date          ?? '2026-03-19');
  return {
    scheduleItems: items.asReadonly(),
    slotGroups:    slotGroups.asReadonly(),
    isLoading:     loading.asReadonly(),
    loadError:     error.asReadonly(),
    date:          date.asReadonly(),
    loadDay:             vi.fn(),
    toggleItem:          vi.fn(),
    toggleMealConsumed:  vi.fn(),
    setMealConsumption:  vi.fn(),
    addItem:             vi.fn(),
    repositionTask:      vi.fn().mockReturnValue(of(undefined)),
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
    load: vi.fn(),
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
    listAnchors: vi.fn().mockReturnValue(of(anchors)),
    deviceZone:  vi.fn().mockReturnValue(zone),
    createAnchor:  vi.fn().mockReturnValue(of({})),
    deleteAnchor:  vi.fn().mockReturnValue(of(undefined)),
    deleteGroup:   vi.fn().mockReturnValue(of({ deleted: 1 })),
    reportDeviceZone: vi.fn().mockReturnValue(of({})),
    resolve:          vi.fn().mockReturnValue(of({ zone: null, day_view: { kind: 'same', incoming_zone: null, current_zone: zone, switch: null } })),
    dismissStandoff:  vi.fn().mockReturnValue(of(undefined)),
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
    source_title: null,
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
    const mealAnchor: ScheduleItem = { id: 'm1', name: 'Breakfast', emoji: '🥑', status: 'done', duringMealTasks: [] };
    const task: ScheduleTask = { id: 't1', type: 'general', label: '💊 Vitamins', status: 'pending', oneShot: false, floating: true };
    const slotGroups: SlotGroup[] = [
      { anchorLabel: 'breakfast', anchor: mealAnchor as MealAnchor, tasks: [] },
      { anchorLabel: 'after-breakfast', anchor: null, tasks: [task] },
    ];
    const svc = makeScheduleServiceMock({
      scheduleItems: [mealAnchor, task],
      slotGroups,
    });
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
    svc.loadDay.mockClear(); // clear the init call

    f.componentInstance.onItemAdded({ label: 'call mum', type: 'general', id: 'srv-1' });

    expect(svc.loadDay).toHaveBeenCalledExactlyOnceWith('2026-03-20');
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
    const spy = vi.spyOn(component['scheduleService'], 'updateEntry');
    component.onEditSave('entry-1', { title: 'X' });
    expect(spy).toHaveBeenCalledWith('entry-1', { title: 'X' });
  });

  it('dims a row only while a different row is being edited', async () => {
    const { component } = await setupEditor();
    const task: ScheduleItem = { id: 't1', type: 'general', label: 'Task', status: 'pending', oneShot: false, floating: false };
    component.editingId.set(null);
    expect(component['isSpotlightDimmed'](task)).toBe(false);      // nothing editing
    component.editingId.set('t1');
    expect(component['isSpotlightDimmed'](task)).toBe(false);      // editing self
    component.editingId.set('other');
    expect(component['isSpotlightDimmed'](task)).toBe(true);       // editing another row
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
    expect(component['isSpotlightDimmed'](meal)).toBe(false);
    component.editingId.set('elsewhere');
    expect(component['isSpotlightDimmed'](meal)).toBe(true);
  });
});

describe('DayViewComponent (toast)', () => {
  function setupToast() {
    const svc = makeScheduleServiceMock();
    TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: makeBriefingServiceMock() },
        { provide: TimezoneService,  useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute,   useValue: mockActivatedRoute },
      ],
    });
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    return f;
  }

  it('shows a toast when onTaskConfirmed is called', async () => {
    const f = setupToast();
    f.componentInstance.onTaskConfirmed('Walk added for after lunch');
    f.detectChanges();
    const toast = f.debugElement.query(By.css('.toast'));
    expect(toast).toBeTruthy();
    expect(toast.nativeElement.textContent).toContain('Walk added for after lunch');
  });

  it('hides the toast after 5000ms', fakeAsync(() => {
    const f = setupToast();
    f.componentInstance.onTaskConfirmed('Walk added');
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeTruthy();

    tick(5000);
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeNull();
  }));

  it('replaces an in-flight toast when a second confirmation arrives', fakeAsync(() => {
    const f = setupToast();
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

  it('hides the toast immediately when the close button is clicked', fakeAsync(() => {
    const f = setupToast();
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
    // Server resolves to divergent: incoming zone (from anchor) differs from current device zone.
    (tzSvc.resolve as Mock).mockReturnValue(of({
      zone: 'America/Denver',
      day_view: { kind: 'divergent', incoming_zone: 'America/Denver', current_zone: 'America/New_York', switch: null },
    }));
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
    (tzSvc.listAnchors as Mock).mockReturnValue(throwError(() => new Error('network')));
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

  it('does not break when tz.resolve errors (listAnchors succeeds)', async () => {
    const tzSvc = makeTimezoneServiceMock();
    (tzSvc.resolve as Mock).mockReturnValue(throwError(() => new Error('resolve failed')));
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
    // forkJoin propagates the resolve error; zoneView stays null, no throw.
    expect(() => f.detectChanges()).not.toThrow();
    expect(f.componentInstance.zoneView()).toBeNull();
  });
});

describe('DayViewComponent (timezone: travel day)', () => {
  const TRAVEL_DATE = '2026-06-20';

  it('renders app-timezone-switch-row when zoneView kind is "travel"', async () => {
    // Intra-day anchor on the travel date → server returns travel kind.
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
    // Server resolves to travel: intra-day switch from New_York to Honolulu.
    (tzSvc.resolve as Mock).mockReturnValue(of({
      zone: 'America/New_York',
      day_view: { kind: 'travel', incoming_zone: null, current_zone: 'America/New_York', switch: { from_zone: 'America/New_York', to_zone: 'Pacific/Honolulu', anchor_id: 'anchor-travel' } },
    }));
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
    // anchor_id → full-DTO resolution from the listAnchors result.
    expect(f.componentInstance.zoneView()!.switch!.anchor.id).toBe('anchor-travel');
    expect(f.debugElement.query(By.css('app-timezone-switch-row'))).toBeTruthy();
  });

  it('passes the anchor source_title to the (why?) popover for an inferred travel anchor', async () => {
    // TRAVEL_DATE (2026-06-20) is a Saturday; an inferred intra-day anchor with a
    // resolved source title should drive the design D5 provenance string.
    const items: ScheduleItem[] = [
      { id: 't1', type: 'general', label: 'Flight', status: 'pending', oneShot: false, floating: false },
    ];
    const anchors: TimezoneAnchorDto[] = [
      makeAnchor({
        id: 'anchor-travel',
        source: 'inferred',
        effective_date: TRAVEL_DATE,
        effective_time: '14:00:00',
        zone: 'Pacific/Honolulu',
        source_title: 'Flight to HNL',
      }),
    ];
    const tzSvc = makeTimezoneServiceMock({ anchors, deviceZone: 'America/New_York' });
    // Server resolves to travel; component resolves switch anchor from listAnchors result.
    (tzSvc.resolve as Mock).mockReturnValue(of({
      zone: 'America/New_York',
      day_view: { kind: 'travel', incoming_zone: null, current_zone: 'America/New_York', switch: { from_zone: 'America/New_York', to_zone: 'Pacific/Honolulu', anchor_id: 'anchor-travel' } },
    }));
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

    f.componentInstance.openWhy(f.componentInstance.zoneView()!.switch!.anchor);
    f.detectChanges();

    const p = f.debugElement.query(By.css('.tz-why-pop__provenance'));
    expect(p.nativeElement.textContent.trim()).toBe('Inferred from "Flight to HNL" on Saturday');
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

// ── Drag-and-drop drop handler tests ─────────────────────────────────────────

describe('DayViewComponent (drag-and-drop)', () => {
  const DROP_DATE = '2026-03-20';

  let t1: ScheduleTask;
  let t2: ScheduleTask;

  beforeEach(() => {
    t1 = { id: 't1', type: 'general', label: 'Task 1', status: 'pending', oneShot: false, floating: true };
    t2 = { id: 't2', type: 'general', label: 'Task 2', status: 'pending', oneShot: false, floating: true };
  });

  async function setupDrop(tasks: ScheduleTask[]) {
    const slotGroups: SlotGroup[] = [
      { anchorLabel: 'lunch', anchor: null, tasks: [...tasks] },
    ];
    const svc = makeScheduleServiceMock({
      scheduleItems: [...tasks],
      slotGroups,
      date: DROP_DATE,
    });
    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: DROP_DATE }) } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    // Prime the slotGroupMap with a mutable copy of the tasks array
    const map = new Map<string, ScheduleTask[]>();
    map.set('lunch', [...tasks]);
    f.componentInstance.slotGroupMap.set(map);
    return { f, component: f.componentInstance, svc };
  }

  it('reorders within a slot and calls repositionTask with the right args', async () => {
    const { component, svc } = await setupDrop([t1, t2]);

    const taskList = component.slotTasks('lunch');
    const drop = {
      previousIndex: 0,
      currentIndex: 1,
      container: { id: 'slot-lunch', data: taskList },
      previousContainer: { id: 'slot-lunch', data: taskList },
      item: { data: t1 },
    } as unknown as CdkDragDrop<ScheduleTask[]>;

    component.onSlotDrop(drop, 'lunch');

    // (a) local slot reordered
    expect(component.slotTasks('lunch').map(t => t.id)).toEqual(['t2', 't1']);

    // (b) repositionTask called with correct args
    expect(svc.repositionTask).toHaveBeenCalledExactlyOnceWith(
      't1',
      DROP_DATE,
      { afterAnchor: 'lunch' },
      1,
    );
  });

  it('does not reorder when previousIndex === currentIndex', async () => {
    const { component, svc } = await setupDrop([t1, t2]);

    const taskList = component.slotTasks('lunch');
    const drop = {
      previousIndex: 0,
      currentIndex: 0,
      container: { id: 'slot-lunch', data: taskList },
      previousContainer: { id: 'slot-lunch', data: taskList },
      item: { data: t1 },
    } as unknown as CdkDragDrop<ScheduleTask[]>;

    component.onSlotDrop(drop, 'lunch');

    expect(component.slotTasks('lunch').map(t => t.id)).toEqual(['t1', 't2']);
    expect(svc.repositionTask).toHaveBeenCalledExactlyOnceWith('t1', DROP_DATE, { afterAnchor: 'lunch' }, 0);
  });

  it('transfers a task from a slot into a meal during-meal list and never mutates the service snapshot', async () => {
    // Build a meal anchor with an empty during-meal list (service-owned snapshot).
    const mealId = 'meal-breakfast';
    const serviceOwnedDuringMeal: ScheduleTask[] = [];
    const mealAnchor: MealAnchor = {
      id: mealId, name: 'Breakfast', emoji: '🥑', status: 'planned',
      duringMealTasks: serviceOwnedDuringMeal,
    };

    const slotGroups: SlotGroup[] = [
      { anchorLabel: 'breakfast', anchor: mealAnchor, tasks: [] },
      { anchorLabel: 'after-breakfast', anchor: null, tasks: [t1, t2] },
    ];
    const svc = makeScheduleServiceMock({
      scheduleItems: [mealAnchor as unknown as ScheduleItem, t1, t2],
      slotGroups,
      date: DROP_DATE,
    });

    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: DROP_DATE }) } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();

    // Manually prime slotGroupMap with mutable copies (as the effect would do in real use).
    const slotMap = new Map<string, ScheduleTask[]>();
    slotMap.set('breakfast', []);
    slotMap.set('after-breakfast', [...[t1, t2]]);
    f.componentInstance.slotGroupMap.set(slotMap);

    // Obtain the day-view-owned clone of the meal anchor.
    // After the fix the mealAnchorMap holds shallow-cloned MealAnchor objects with
    // their own duringMealTasks arrays — separate from serviceOwnedDuringMeal.
    const clonedMeal = f.componentInstance.mealAnchor(mealId)!;

    // Source list: the day-view-owned slot list for 'after-breakfast'.
    const sourceSlotList = f.componentInstance.slotTasks('after-breakfast');
    // Destination list: the day-view-owned during-meal list for the cloned meal.
    const destMealList = clonedMeal.duringMealTasks;

    const drop = {
      previousIndex: 0,
      currentIndex: 0,
      container: { id: `meal-${mealId}`, data: destMealList },
      previousContainer: { id: 'slot-after-breakfast', data: sourceSlotList },
      item: { data: t1 },
    } as unknown as CdkDragDrop<ScheduleTask[]>;

    f.componentInstance.onMealDrop(drop, mealId);

    // (a) t1 moved into the meal's day-view-owned during-meal list at index 0.
    expect(clonedMeal.duringMealTasks.map((t: ScheduleTask) => t.id)).toEqual(['t1']);

    // (b) source slot list no longer contains t1.
    expect(f.componentInstance.slotTasks('after-breakfast').map((t: ScheduleTask) => t.id)).toEqual(['t2']);

    // (c) repositionTask called with mealAnchorId + position.
    expect(svc.repositionTask).toHaveBeenCalledExactlyOnceWith(
      't1',
      DROP_DATE,
      { mealAnchorId: mealId },
      0,
    );

    // (d) CRUCIALLY: the service's snapshot object was NOT mutated.
    // clonedMeal.duringMealTasks must be a different array reference than serviceOwnedDuringMeal.
    expect(clonedMeal.duringMealTasks).not.toBe(serviceOwnedDuringMeal);
    expect(serviceOwnedDuringMeal.length, 'service snapshot must not be mutated').toBe(0);
  });

  // The `dragging` class is what gates the slot min-height (#1001): present only
  // mid-drag so the resting layout stays flush. onDragStarted/onDragEnded toggle
  // it via a synchronous DOM mutation — see the handler comment for why it can't
  // be an Angular binding. (The mid-drag *geometry* is covered end-to-end by
  // day-view-drag-slot-gap.e2e.ts; here we just lock the toggle itself.)
  it('toggles the `dragging` class on the schedule list across a drag', async () => {
    const { f } = await setupDrop([t1, t2]);
    const list = f.debugElement.query(By.css('.schedule-list')).nativeElement as HTMLElement;

    expect(list.classList.contains('dragging')).toBe(false);

    f.componentInstance.onDragStarted();
    expect(list.classList.contains('dragging')).toBe(true);

    f.componentInstance.onDragEnded();
    expect(list.classList.contains('dragging')).toBe(false);
  });

  it('clears a stuck `dragging` class on a document pointer release (CDK dispose safety net)', async () => {
    const { f } = await setupDrop([t1, t2]);
    const list = f.debugElement.query(By.css('.schedule-list')).nativeElement as HTMLElement;

    // Simulate the class being left on by a drag whose cdkDragEnded never fired
    // (CdkDrag.dispose() completes the emitter without emitting).
    f.componentInstance.onDragStarted();
    expect(list.classList.contains('dragging')).toBe(true);

    // A physical pointer release on the document must clear it regardless.
    document.dispatchEvent(new Event('mouseup'));
    expect(list.classList.contains('dragging')).toBe(false);
  });
});

// ── Keyboard / button reorder tests ──────────────────────────────────────────

describe('DayViewComponent (keyboard reorder)', () => {
  it('keyboard down on a slot task calls repositionTask with the next position', () => {
    const tasks: ScheduleTask[] = [
      { id: 'a', type: 'general', label: 'A', status: 'pending', oneShot: false, floating: true },
      { id: 'b', type: 'general', label: 'B', status: 'pending', oneShot: false, floating: true },
    ];
    const slotGroups: SlotGroup[] = [{ anchorLabel: 'start of day', anchor: null, tasks }];
    const svc = makeScheduleServiceMock({ scheduleItems: tasks, slotGroups });
    TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: '2026-03-19' }) } },
      ],
    });
    const fixture = TestBed.createComponent(DayViewComponent);
    fixture.detectChanges();

    // First task's down control.
    const downBtns = fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'));
    downBtns[0].nativeElement.click();

    expect(svc.repositionTask).toHaveBeenCalledWith('a', '2026-03-19', { afterAnchor: 'start of day' }, 1);
  });

  it('keyboard up on the top slot task moves it into the preceding meal pairing', () => {
    const meal: MealAnchor = {
      id: 'm1', name: 'Breakfast', emoji: '🥣', status: 'planned', duringMealTasks: [],
    };
    const slotTask: ScheduleTask = { id: 'c', type: 'general', label: 'C', status: 'pending', oneShot: false, floating: true };
    const slotGroups: SlotGroup[] = [{ anchorLabel: 'breakfast', anchor: meal, tasks: [slotTask] }];
    const svc = makeScheduleServiceMock({ scheduleItems: [meal, slotTask], slotGroups });
    TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: '2026-03-19' }) } },
      ],
    });
    const fixture = TestBed.createComponent(DayViewComponent);
    fixture.detectChanges();
    // The slot task's up control (the meal's during-meal list is empty, so this is the only up button).
    fixture.debugElement.queryAll(By.css('[data-testid="reorder-up"]'))
      .at(-1)!.nativeElement.click();
    expect(svc.repositionTask).toHaveBeenCalledWith('c', '2026-03-19', { mealAnchorId: 'm1' }, 0);
  });

  it('rolls back via loadDay when reposition fails', () => {
    const tasks: ScheduleTask[] = [
      { id: 'a', type: 'general', label: 'A', status: 'pending', oneShot: false, floating: true },
      { id: 'b', type: 'general', label: 'B', status: 'pending', oneShot: false, floating: true },
    ];
    const svc = makeScheduleServiceMock({ scheduleItems: tasks, slotGroups: [{ anchorLabel: 'start of day', anchor: null, tasks }] });
    svc.repositionTask = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
    TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        { provide: ScheduleService, useValue: svc },
        { provide: BriefingService, useValue: makeBriefingServiceMock() },
        { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ date: '2026-03-19' }) } },
      ],
    });
    const fixture = TestBed.createComponent(DayViewComponent);
    fixture.detectChanges();
    fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'))[0].nativeElement.click();
    expect(svc.loadDay).toHaveBeenCalledWith('2026-03-19');
  });
});
