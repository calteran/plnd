import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DayTypesSubstepComponent } from './day-types-substep';
import { DayTypesService } from '../../../../../core/services/day-types.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { DayTypeResponse } from '../../../../../core/models/day-type';
import { PreferencesService } from '../../../../../core/services/preferences.service';

const MOCK_RESPONSE: DayTypeResponse = {
  id: 'abc-123',
  user_id: 'user-1',
  name: 'Weekdays',
  days_bitmask: 62,
  wake_time: '07:00:00',
  sleep_time: '22:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
  cycle_bitmask: 0,
  created_at: '2024-01-01T00:00:00Z',
};

function makeStateMock(storedTypes: DayTypeResponse[] = []) {
  const typesSignal: WritableSignal<DayTypeResponse[]> = signal(storedTypes);
  return {
    dayTypes: typesSignal.asReadonly(),
    setDayTypes: jasmine.createSpy('setDayTypes'),
  };
}

function makeDayTypesSvcMock() {
  const spy = jasmine.createSpyObj<DayTypesService>('DayTypesService', [
    'create',
    'update',
    'list',
    'delete',
    'listMeals',
    'createMeal',
    'deleteMeal',
  ]);
  spy.list.and.returnValue(of([]));
  spy.listMeals.and.returnValue(of([]));
  spy.createMeal.and.returnValue(
    of({ id: 'new-meal', day_type_id: 'dt1', user_id: 'u1', name: 'Breakfast',
         preferred_time: '08:00:00', tolerance_minutes: 30, sort_order: 0,
         created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
  );
  spy.deleteMeal.and.returnValue(of(undefined));
  return spy;
}

describe('DayTypesSubstepComponent', () => {
  async function setup(storedTypes: DayTypeResponse[] = []) {
    const stateMock = makeStateMock(storedTypes);
    const svcMock = makeDayTypesSvcMock();
    svcMock.create.and.returnValue(of(MOCK_RESPONSE));
    svcMock.update.and.returnValue(of(MOCK_RESPONSE));

    // PreferencesService is needed by OnboardingStateService constructor
    const prefsMock = {
      preferences: jasmine.createSpy('preferences').and.returnValue(null),
    };

    await TestBed.configureTestingModule({
      imports: [DayTypesSubstepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: OnboardingStateService, useValue: stateMock },
        { provide: DayTypesService, useValue: svcMock },
        { provide: PreferencesService, useValue: prefsMock },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<DayTypesSubstepComponent> =
      TestBed.createComponent(DayTypesSubstepComponent);
    const component = fixture.componentInstance;
    return { fixture, component, stateMock, svcMock };
  }

  // ── 1. Default cards on first visit ─────────────────────────────────────────

  it('renders two default cards (Weekdays + Weekends) when stateService has no stored types', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.schedule-card');
    expect(cards.length).toBe(2);
    const inputs: NodeListOf<HTMLInputElement> =
      fixture.nativeElement.querySelectorAll('.card-name-input');
    expect(inputs[0].value).toBe('Weekdays');
    expect(inputs[1].value).toBe('Weekends');
  });

  // ── 2. Pre-populate from stateService on return visit ───────────────────────

  it('fetches from server when stateService is empty and uses server types when present', async () => {
    // Regression: page refresh clears in-memory state; without a server fetch the component
    // showed default cards (id=null), causing save() to POST duplicates that fail the
    // bitmask-overlap constraint with a 422.
    const serverTypes: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'srv-1', name: 'Work Days', days_bitmask: 62 },
      { ...MOCK_RESPONSE, id: 'srv-2', name: 'Rest Days', days_bitmask: 65 },
    ];
    const { fixture, svcMock } = await setup(); // state empty
    svcMock.list.and.returnValue(of(serverTypes));
    fixture.detectChanges(); // triggers ngOnInit → list() → cards set from server
    const inputs: NodeListOf<HTMLInputElement> =
      fixture.nativeElement.querySelectorAll('.card-name-input');
    expect(inputs.length).toBe(2);
    expect(inputs[0].value).toBe('Work Days');
    expect(inputs[1].value).toBe('Rest Days');
  });

  it('pre-populates cards from stateService.dayTypes() when non-empty', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'id-1', name: 'Work Days', days_bitmask: 62 },
      { ...MOCK_RESPONSE, id: 'id-2', name: 'Rest Days', days_bitmask: 65 },
    ];
    const { fixture } = await setup(stored);
    fixture.detectChanges();
    const inputs: NodeListOf<HTMLInputElement> =
      fixture.nativeElement.querySelectorAll('.card-name-input');
    expect(inputs.length).toBe(2);
    expect(inputs[0].value).toBe('Work Days');
    expect(inputs[1].value).toBe('Rest Days');
  });

  // ── 3. Claiming a day moves it to the clicked card ───────────────────────────

  it('clicking a day pill claims it for that card and removes it from the previous owner', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // Card 0 is "Weekdays" (bitmask 62, Mon–Fri). Card 1 is "Weekends" (bitmask 65, Sat+Sun, bit 0=Sun).
    // Click Sunday pill (bit 0, last pill in DAY_PILLS order M T W T F S S) on card 0.
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const dayPills: NodeListOf<HTMLButtonElement> = firstCard.querySelectorAll('.day-pill');
    const sundayPill = dayPills[6];
    sundayPill.click();
    fixture.detectChanges();
    // Card 0 gains bit 0: 62 | 1 = 63
    expect(component.cards()[0].days_bitmask).toBe(63);
    // Card 1 loses bit 0: 65 & ~1 = 64
    expect(component.cards()[1].days_bitmask).toBe(64);
  });

  it('clicking an already-active day pill is a no-op', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // Monday is bit 1, already set on Weekdays (bitmask 62).
    component.toggleDay(0, 1);
    expect(component.cards()[0].days_bitmask).toBe(62);
    expect(component.cards()[1].days_bitmask).toBe(65);
  });

  it('toggleDay is a no-op when in cycle mode', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    const before = component.cards()[0].days_bitmask;
    component.toggleDay(0, 0);
    expect(component.cards()[0].days_bitmask).toBe(before);
  });

  // ── 4. ✕ button is disabled when bitmask > 0 ────────────────────────────────

  it('remove button is disabled when days_bitmask is non-zero in DOW mode', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const removeBtn: HTMLButtonElement = firstCard.querySelector('.remove-btn')!;
    // days_bitmask=62 for Weekdays, so button should be disabled
    expect(removeBtn.disabled).toBeTrue();
  });

  it('remove button has aria-disabled=true when bitmask > 0', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const removeBtn: HTMLButtonElement = firstCard.querySelector('.remove-btn')!;
    expect(removeBtn.getAttribute('aria-disabled')).toBe('true');
  });

  // ── 5. ✕ button enabled when bitmask = 0 ────────────────────────────────────

  it('remove button is enabled when days_bitmask is zero', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // Set card 0 bitmask to 0
    component.updateCard(0, { days_bitmask: 0 });
    fixture.detectChanges();
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const removeBtn: HTMLButtonElement = firstCard.querySelector('.remove-btn')!;
    expect(removeBtn.disabled).toBeFalse();
  });

  // ── 6. Tapping disabled ✕ shows inline hint text ────────────────────────────

  it('clicking disabled remove button shows inline hint text', fakeAsync(async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // days_bitmask=62, button is disabled — call onRemoveClick directly since disabled btn won't fire click
    component.onRemoveClick(0);
    fixture.detectChanges();
    const hint = fixture.nativeElement.querySelector('.remove-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('Uncheck all days before removing');
    tick(3001);
  }));

  // ── 7. Hint auto-dismisses after 3 seconds ──────────────────────────────────

  it('inline hint auto-dismisses after 3 seconds', fakeAsync(async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.onRemoveClick(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.remove-hint')).not.toBeNull();
    tick(3001);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.remove-hint')).toBeNull();
  }));

  // ── 8. "+ Add day type" appends a blank card ────────────────────────────────

  it('clicking "+ Add day type" appends a new blank card', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const addBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.add-link');
    addBtn.click();
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.schedule-card');
    expect(cards.length).toBe(3);
    const inputs: NodeListOf<HTMLInputElement> =
      fixture.nativeElement.querySelectorAll('.card-name-input');
    expect(inputs[2].value).toBe('');
  });

  // ── 8b. enterCycleMode wipes DOW cards and starts a single cycle card ───────

  it('enterCycleMode wipes existing DOW cards and creates a single cycle card claiming all 7 positions', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    expect(component.cards().length).toBe(2);
    component.enterCycleMode();
    fixture.detectChanges();
    expect(component.mode()).toBe('cycle');
    expect(component.cycleLength()).toBe(7);
    expect(component.anchorDate()).not.toBeNull();
    expect(component.cards().length).toBe(1);
    // Top card claims positions 1..7 → bitmask 0b1111111 = 127
    expect(component.cards()[0].cycle_bitmask).toBe(127);
  });

  it('"Switch to rotating schedule" link calls enterCycleMode and reveals cycle-length / anchor-date inputs', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    const addLinks = fixture.nativeElement.querySelectorAll('.add-link') as NodeListOf<HTMLButtonElement>;
    // First link is "+ Add day type", second is the mode switch
    const switchLink = Array.from(addLinks).find(b => b.textContent?.includes('rotating'))!;
    switchLink.click();
    fixture.detectChanges();
    expect(component.mode()).toBe('cycle');
    const cycleInputs = fixture.nativeElement.querySelectorAll('.cycle-input') as NodeListOf<HTMLInputElement>;
    expect(cycleInputs.length).toBe(2);
    const types = Array.from(cycleInputs).map(i => i.type);
    expect(types).toContain('number');
    expect(types).toContain('date');
  });

  it('enterDOWMode wipes cycle cards and restores the default DOW two-card setup', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    fixture.detectChanges();
    expect(component.cards().length).toBe(1);
    component.enterDOWMode();
    fixture.detectChanges();
    expect(component.mode()).toBe('dow');
    expect(component.cycleLength()).toBeNull();
    expect(component.anchorDate()).toBeNull();
    expect(component.cards().length).toBe(2);
    expect(component.cards()[0].name).toBe('Weekdays');
    expect(component.cards()[1].name).toBe('Weekends');
  });

  // ── 9. Cycle position toggle: auto-steal between cards ──────────────────────

  it('clicking a cycle position on another card steals it from the original owner', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    component.addCard(); // second cycle card, cycle_bitmask=0
    fixture.detectChanges();
    expect(component.cards()[0].cycle_bitmask).toBe(127);
    expect(component.cards()[1].cycle_bitmask).toBe(0);
    // Click position 3 on card 1 — should steal bit 2 (1 << 2 = 4) from card 0.
    component.toggleCycleDay(1, 3);
    expect(component.cards()[0].cycle_bitmask).toBe(127 & ~0b100); // 123
    expect(component.cards()[1].cycle_bitmask).toBe(0b100); // 4
  });

  it('clicking a cycle position the card already owns is a no-op', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    fixture.detectChanges();
    // Card 0 owns position 1 (bit 0) by default. Toggling it should not flip the bit off.
    component.toggleCycleDay(0, 1);
    expect(component.cards()[0].cycle_bitmask).toBe(127);
  });

  it('toggleCycleDay is a no-op when in DOW mode', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // We're in DOW mode by default. Cards have cycle_bitmask=0; toggleCycleDay should not change them.
    component.toggleCycleDay(0, 1);
    expect(component.cards()[0].cycle_bitmask).toBe(0);
  });

  // ── 9b. setCycleLength adjusts coverage ──────────────────────────────────────

  it('setCycleLength expanding moves new positions to the top card', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode(); // length=7, top card claims 0b1111111
    fixture.detectChanges();
    component.setCycleLength(10);
    // Top card now claims positions 0..9 → 0b1111111111 = 1023
    expect(component.cycleLength()).toBe(10);
    expect(component.cards()[0].cycle_bitmask).toBe(1023);
  });

  it('setCycleLength shrinking masks bits beyond the new length off every card', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode(); // length=7
    component.addCard();
    // Steal positions 6 and 7 (bits 5 and 6, value 0b1100000=96) to card 1
    component.toggleCycleDay(1, 6);
    component.toggleCycleDay(1, 7);
    expect(component.cards()[0].cycle_bitmask).toBe(127 & ~96); // 31
    expect(component.cards()[1].cycle_bitmask).toBe(96);
    component.setCycleLength(4);
    // Length=4 → low 4 bits only. Card 0 keeps low bits (31 & 15 = 15). Card 1 loses its high bits.
    expect(component.cycleLength()).toBe(4);
    expect(component.cards()[0].cycle_bitmask).toBe(15);
    expect(component.cards()[1].cycle_bitmask).toBe(0);
  });

  it('setCycleLength clamps to 1..30', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    component.setCycleLength(99);
    expect(component.cycleLength()).toBe(30);
    component.setCycleLength(0);
    expect(component.cycleLength()).toBe(1);
  });

  it('setCycleLength is a no-op when given NaN', async () => {
    // Regression: 1 << NaN evaluates to 1 in JS (NaN→0 coercion), so without a guard
    // a NaN input would silently clear every position's bit on every card.
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.enterCycleMode(); // length=7, top card bitmask=127
    component.setCycleLength(NaN);
    expect(component.cycleLength()).toBe(7);
    expect(component.cards()[0].cycle_bitmask).toBe(127);
  });

  // ── 9c. Mode switch queues server records for deferred deletion ──────────────

  it('enterCycleMode queues existing server-side day-type IDs for deferred deletion', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'srv-1', name: 'Weekdays', days_bitmask: 62 },
      { ...MOCK_RESPONSE, id: 'srv-2', name: 'Weekends', days_bitmask: 65 },
    ];
    const { fixture, component } = await setup(stored);
    fixture.detectChanges();
    expect(component.pendingDeletions()).toEqual([]);
    component.enterCycleMode();
    expect(component.pendingDeletions().sort()).toEqual(['srv-1', 'srv-2']);
  });

  it('enterDOWMode queues existing server-side cycle records for deferred deletion', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'cyc-1', name: 'Day', is_cycle: true, cycle_length: 2, anchor_date: '2026-01-01', days_bitmask: 0, cycle_bitmask: 0b01 },
      { ...MOCK_RESPONSE, id: 'cyc-2', name: 'Night', is_cycle: true, cycle_length: 2, anchor_date: '2026-01-01', days_bitmask: 0, cycle_bitmask: 0b10 },
    ];
    const { fixture, component } = await setup(stored);
    fixture.detectChanges();
    component.enterDOWMode();
    expect(component.pendingDeletions().sort()).toEqual(['cyc-1', 'cyc-2']);
  });

  it('mode switch on client-only (id=null) cards leaves pendingDeletions empty', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // Default cards have id=null on first visit
    component.enterCycleMode();
    expect(component.pendingDeletions()).toEqual([]);
  });

  it('save() deletes pendingDeletions before creating new records and clears the queue', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'srv-1', name: 'Weekdays', days_bitmask: 62 },
      { ...MOCK_RESPONSE, id: 'srv-2', name: 'Weekends', days_bitmask: 65 },
    ];
    const { fixture, component, svcMock } = await setup(stored);
    svcMock.delete.and.returnValue(of(undefined));
    fixture.detectChanges();
    component.enterCycleMode();
    component.anchorDate.set('2026-05-11');
    component.save();
    fixture.detectChanges();
    expect(svcMock.delete).toHaveBeenCalledWith('srv-1');
    expect(svcMock.delete).toHaveBeenCalledWith('srv-2');
    expect(svcMock.create).toHaveBeenCalledTimes(1);
    expect(component.pendingDeletions()).toEqual([]);
  });

  // ── 10. Save: create() called, setDayTypes called, complete emitted ─────────

  it('save() calls DayTypesService.create() for new cards and emits complete', async () => {
    const { fixture, component, stateMock, svcMock } = await setup();
    fixture.detectChanges();
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    component.save();
    fixture.detectChanges();
    // Two default cards, both new (no id)
    expect(svcMock.create).toHaveBeenCalledTimes(2);
    expect(stateMock.setDayTypes).toHaveBeenCalledTimes(1);
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  });

  it('save() calls DayTypesService.update() for cards with existing ids', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'existing-id', name: 'Weekdays', days_bitmask: 62 },
    ];
    const { fixture, component, svcMock } = await setup(stored);
    fixture.detectChanges();
    component.save();
    expect(svcMock.update).toHaveBeenCalledWith('existing-id', jasmine.any(Object));
    expect(svcMock.create).not.toHaveBeenCalled();
  });

  it('save() in cycle mode sends cycle_bitmask + cycle_length + anchor_date and zeros days_bitmask', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    component.anchorDate.set('2026-05-11');
    component.save();
    expect(svcMock.create).toHaveBeenCalledTimes(1);
    const payload = svcMock.create.calls.mostRecent().args[0];
    expect(payload.is_cycle).toBeTrue();
    expect(payload.cycle_length).toBe(7);
    expect(payload.anchor_date).toBe('2026-05-11');
    expect(payload.cycle_bitmask).toBe(127);
    expect(payload.days_bitmask).toBe(0);
  });

  it('save() in DOW mode sends cycle_bitmask=0 and is_cycle=false', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    component.save();
    const payload = svcMock.create.calls.first().args[0];
    expect(payload.is_cycle).toBeFalse();
    expect(payload.cycle_bitmask).toBe(0);
    expect(payload.cycle_length).toBeNull();
    expect(payload.anchor_date).toBeNull();
  });

  // ── 11. Validation: does NOT save when a 7-day card has days_bitmask = 0 ────

  it('save() does NOT emit complete when a 7-day card has days_bitmask = 0', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    // Force card 0 to have no days selected
    component.updateCard(0, { days_bitmask: 0 });
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    component.save();
    expect(svcMock.create).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('save() shows validation error when a card has days_bitmask = 0', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    component.updateCard(0, { days_bitmask: 0 });
    component.save();
    fixture.detectChanges();
    const errorEl = fixture.nativeElement.querySelector('.save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('at least one day');
  });

  it('save() in cycle mode shows error when anchor_date is missing', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    component.anchorDate.set(null);
    component.save();
    fixture.detectChanges();
    expect(svcMock.create).not.toHaveBeenCalled();
    const errorEl = fixture.nativeElement.querySelector('.save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('cycle length and start date');
  });

  it('save() in cycle mode shows error when a card has cycle_bitmask = 0', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    component.addCard(); // appends a cycle card with cycle_bitmask=0
    component.save();
    fixture.detectChanges();
    expect(svcMock.create).not.toHaveBeenCalled();
    const errorEl = fixture.nativeElement.querySelector('.save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('claim at least one position');
  });

  it('save() in cycle mode shows error when combined bitmask does not cover every position', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    component.enterCycleMode();
    // Manually leave a gap: clear bit 0 from the top card without claiming it elsewhere.
    component.updateCard(0, { cycle_bitmask: 127 & ~1 });
    component.save();
    fixture.detectChanges();
    expect(svcMock.create).not.toHaveBeenCalled();
    const errorEl = fixture.nativeElement.querySelector('.save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('cover every day in the cycle');
  });

  // ── 12. Save error shown on API failure ──────────────────────────────────────

  it('save() shows save-error message when API call fails', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    svcMock.create.and.returnValue(throwError(() => new Error('Network error')));
    component.save();
    fixture.detectChanges();
    const errorEl = fixture.nativeElement.querySelector('.save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to save day types');
  });

  // ── 13. onRemoveClick: server delete for existing cards ──────────────────────

  it('onRemoveClick() calls delete() and removes card on success when card has an id', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'del-id', name: 'To Delete', days_bitmask: 0 },
    ];
    const { component, svcMock } = await setup(stored);
    svcMock.delete.and.returnValue(of(undefined));
    component.ngOnInit();

    expect(component.cards().length).toBe(1);
    component.onRemoveClick(0);
    expect(svcMock.delete).toHaveBeenCalledWith('del-id');
    expect(component.cards().length).toBe(0);
  });

  it('onRemoveClick() shows deleteError when server delete fails', async () => {
    const stored: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'del-id', name: 'To Delete', days_bitmask: 0 },
    ];
    const { fixture, component, svcMock } = await setup(stored);
    svcMock.delete.and.returnValue(throwError(() => new Error('Network error')));
    fixture.detectChanges();

    component.onRemoveClick(0);
    fixture.detectChanges();

    expect(component.deleteError()).toBeTrue();
    expect(component.cards().length).toBe(1); // card not removed on error
  });

  it('onRemoveClick() removes client-only card immediately (no server call)', async () => {
    const { component, svcMock } = await setup();
    component.ngOnInit();
    // Default cards have id=null; clear bitmask to enable removal
    component.updateCard(0, { days_bitmask: 0 });

    expect(component.cards().length).toBe(2);
    component.onRemoveClick(0);
    expect(svcMock.delete).not.toHaveBeenCalled();
    expect(component.cards().length).toBe(1);
  });

  // ── 13b. responseToCard / ngOnInit round-trip cycle_bitmask + mode ──────────

  it('hydrates substep-level mode/cycleLength/anchorDate from server cycle types', async () => {
    const serverTypes: DayTypeResponse[] = [
      { ...MOCK_RESPONSE, id: 'cyc-1', name: 'Day', is_cycle: true, cycle_length: 4, anchor_date: '2026-01-01', days_bitmask: 0, cycle_bitmask: 0b0011 },
      { ...MOCK_RESPONSE, id: 'cyc-2', name: 'Night', is_cycle: true, cycle_length: 4, anchor_date: '2026-01-01', days_bitmask: 0, cycle_bitmask: 0b1100 },
    ];
    const { fixture, component, svcMock } = await setup();
    svcMock.list.and.returnValue(of(serverTypes));
    fixture.detectChanges();
    expect(component.mode()).toBe('cycle');
    expect(component.cycleLength()).toBe(4);
    expect(component.anchorDate()).toBe('2026-01-01');
    expect(component.cards().length).toBe(2);
    expect(component.cards()[0].cycle_bitmask).toBe(0b0011);
    expect(component.cards()[1].cycle_bitmask).toBe(0b1100);
  });

  // ── 14. addMeal ─────────────────────────────────────────────────────────────

  describe('addMeal', () => {
    it('adds a new draft meal to the specified card', async () => {
      const { component } = await setup();
      component.cards.set([{
        localId: 'c1', id: null, name: 'Weekdays', days_bitmask: 62, cycle_bitmask: 0,
        wake_time: '07:00', sleep_time: '22:00', showRemoveHint: false,
        meals: [],
      }]);
      component.addMeal(0);
      expect(component.cards()[0].meals.length).toBe(1);
      expect(component.cards()[0].meals[0].id).toBeNull();
    });
  });

  // ── 15. removeMeal ───────────────────────────────────────────────────────────

  describe('removeMeal', () => {
    it('removes a meal by localId', async () => {
      const { component } = await setup();
      component.cards.set([{
        localId: 'c1', id: null, name: 'Weekdays', days_bitmask: 62, cycle_bitmask: 0,
        wake_time: '07:00', sleep_time: '22:00', showRemoveHint: false,
        meals: [
          { localId: 'ml1', id: null, name: 'Breakfast', preferred_time: '08:00', tolerance_minutes: 30, sort_order: 0 },
          { localId: 'ml2', id: null, name: 'Lunch', preferred_time: '12:00', tolerance_minutes: 30, sort_order: 1 },
        ],
      }]);
      component.removeMeal(0, 'ml1');
      expect(component.cards()[0].meals.length).toBe(1);
      expect(component.cards()[0].meals[0].localId).toBe('ml2');
    });

    it('does not remove the last meal', async () => {
      const { component } = await setup();
      component.cards.set([{
        localId: 'c1', id: null, name: 'Weekdays', days_bitmask: 62, cycle_bitmask: 0,
        wake_time: '07:00', sleep_time: '22:00', showRemoveHint: false,
        meals: [{ localId: 'ml1', id: null, name: 'Breakfast', preferred_time: '08:00', tolerance_minutes: 30, sort_order: 0 }],
      }]);
      component.removeMeal(0, 'ml1');
      expect(component.cards()[0].meals.length).toBe(1);
    });
  });

  // ── 16. updateMeal ───────────────────────────────────────────────────────────

  describe('updateMeal', () => {
    it('patches a meal by localId', async () => {
      const { component } = await setup();
      component.cards.set([{
        localId: 'c1', id: null, name: 'Weekdays', days_bitmask: 62, cycle_bitmask: 0,
        wake_time: '07:00', sleep_time: '22:00', showRemoveHint: false,
        meals: [{ localId: 'ml1', id: null, name: 'Breakfast', preferred_time: '08:00', tolerance_minutes: 30, sort_order: 0 }],
      }]);
      component.updateMeal(0, 'ml1', { preferred_time: '09:00' });
      expect(component.cards()[0].meals[0].preferred_time).toBe('09:00');
    });
  });
});
