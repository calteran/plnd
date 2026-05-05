import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ScheduleTypesSubstepComponent } from './schedule-types-substep';
import { DayTypesService } from '../../../../../core/services/schedule-types.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { DayTypeResponse } from '../../../../../core/models/schedule-type';
import { PreferencesService } from '../../../../../core/services/preferences.service';

const MOCK_RESPONSE: DayTypeResponse = {
  id: 'abc-123',
  user_id: 'user-1',
  name: 'Weekdays',
  days_bitmask: 62,
  wake_time: '07:00:00',
  sleep_time: '22:00:00',
  is_default: false,
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
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
  return jasmine.createSpyObj<DayTypesService>('DayTypesService', [
    'create',
    'update',
    'list',
    'delete',
  ]);
}

describe('ScheduleTypesSubstepComponent', () => {
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
      imports: [ScheduleTypesSubstepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: OnboardingStateService, useValue: stateMock },
        { provide: DayTypesService, useValue: svcMock },
        { provide: PreferencesService, useValue: prefsMock },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<ScheduleTypesSubstepComponent> =
      TestBed.createComponent(ScheduleTypesSubstepComponent);
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

  it('claiming a day does not affect cycle-mode cards', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // Enable cycle mode on card 1; give it a bitmask to verify it stays untouched.
    component.enableCycleMode(1);
    component.updateCard(1, { days_bitmask: 0b0101 });
    // Claim Sunday (bit 0) on card 0 — card 0 doesn't own it yet after enableCycleMode cleared card 1.
    component.toggleDay(0, 0);
    // Card 1 (cycle) should be unchanged.
    expect(component.cards()[1].days_bitmask).toBe(0b0101);
  });

  // ── 4. ✕ button is disabled when days_bitmask > 0 ───────────────────────────

  it('remove button is disabled when days_bitmask is non-zero', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const removeBtn: HTMLButtonElement = firstCard.querySelector('.remove-btn')!;
    // days_bitmask=62 for Weekdays, so button should be disabled
    expect(removeBtn.disabled).toBeTrue();
  });

  it('remove button has aria-disabled=true when days_bitmask > 0', async () => {
    const { fixture } = await setup();
    fixture.detectChanges();
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const removeBtn: HTMLButtonElement = firstCard.querySelector('.remove-btn')!;
    expect(removeBtn.getAttribute('aria-disabled')).toBe('true');
  });

  // ── 5. ✕ button enabled when days_bitmask = 0 ───────────────────────────────

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
    expect(hint.textContent).toContain('Uncheck all days before removing this type');
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

  // ── 8. "+ Add schedule type" appends a blank card ───────────────────────────

  it('clicking "+ Add schedule type" appends a new blank card', async () => {
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

  // ── 8b. "Non-7-day schedule?" appends a cycle card ───────────────────────────

  it('clicking "Non-7-day schedule?" appends a card with is_cycle=true and cycle_length=1', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    const addLinks: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.add-link');
    addLinks[1].click(); // second add-link is "Non-7-day schedule?"
    fixture.detectChanges();
    const cards = component.cards();
    expect(cards.length).toBe(3);
    expect(cards[2].is_cycle).toBeTrue();
    expect(cards[2].cycle_length).toBe(1);
    const cycleInputs: NodeListOf<HTMLInputElement> =
      fixture.nativeElement.querySelectorAll('.schedule-card')[2].querySelectorAll('.cycle-input');
    expect(cycleInputs.length).toBe(2);
  });

  // ── 9. Cycle mode toggle shows cycle-length and anchor-date inputs ───────────

  it('clicking "Non-7-day schedule?" shows cycle-length and anchor-date inputs', async () => {
    const { fixture, component } = await setup();
    fixture.detectChanges();
    // Enable cycle mode programmatically
    component.enableCycleMode(0);
    fixture.detectChanges();
    const firstCard = fixture.nativeElement.querySelectorAll('.schedule-card')[0];
    const cycleInputs: NodeListOf<HTMLInputElement> =
      firstCard.querySelectorAll('.cycle-input');
    expect(cycleInputs.length).toBe(2);
    const types = Array.from(cycleInputs).map(i => i.type);
    expect(types).toContain('number');
    expect(types).toContain('date');
  });

  // ── 10. Save: create() called, setDayTypes called, complete emitted ─────

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

  // ── 11. Validation: does NOT save when a 7-day card has days_bitmask = 0 ─────

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

  it('save shows error when cycle card is missing anchor date', async () => {
    const { fixture, component, svcMock } = await setup();
    fixture.detectChanges();
    // Add a blank card and enable cycle mode with cycle_length but no anchor_date
    component.addCard();
    const cycleCardIdx = component.cards().length - 1;
    component.updateCard(cycleCardIdx, {
      is_cycle: true,
      cycle_length: 7,
      anchor_date: null,
      days_bitmask: 0,
    });
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    component.save();
    fixture.detectChanges();
    expect(svcMock.create).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
    const errorEl = fixture.nativeElement.querySelector('.save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Cycle day types must have a cycle length and start date.');
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
});
