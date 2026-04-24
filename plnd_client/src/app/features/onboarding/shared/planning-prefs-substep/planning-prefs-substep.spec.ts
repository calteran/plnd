import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { of } from 'rxjs';
import { PlanningPrefsSubstepComponent } from './planning-prefs-substep';
import { OnboardingStateService } from '../../onboarding-state.service';
import { PreferencesService } from '../../../../core/services/preferences.service';
import { UserPreferences } from '../../../../core/models/preferences';

const MOCK_PREFS: UserPreferences = {
  user_id: 'u1',
  week_start_day: 1,
  planning_trigger_offset: -1,
  default_plan_length_days: 14,
  wake_time: '07:00:00',
  email_notifications_enabled: false,
  sms_notifications_enabled: false,
  push_notifications_enabled: false,
  phone_number: null,
  created_at: '',
  updated_at: '',
};

function makeStateMock(planningPrefsComplete: boolean) {
  const prefsCompleteSignal: WritableSignal<boolean> = signal(planningPrefsComplete);
  return {
    planningPrefsComplete: prefsCompleteSignal.asReadonly(),
    setPlanningPrefsComplete: jasmine.createSpy('setPlanningPrefsComplete'),
    computeAndSetPlanPeriod: jasmine.createSpy('computeAndSetPlanPeriod'),
  };
}

function makePrefsMock() {
  return {
    patchPreferences: jasmine.createSpy('patchPreferences').and.returnValue(of(MOCK_PREFS)),
  };
}

describe('PlanningPrefsSubstepComponent', () => {
  async function setup(planningPrefsComplete: boolean) {
    const stateMock = makeStateMock(planningPrefsComplete);
    const prefsMock = makePrefsMock();

    await TestBed.configureTestingModule({
      imports: [PlanningPrefsSubstepComponent],
      providers: [
        { provide: OnboardingStateService, useValue: stateMock },
        { provide: PreferencesService, useValue: prefsMock },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<PlanningPrefsSubstepComponent> =
      TestBed.createComponent(PlanningPrefsSubstepComponent);
    const component = fixture.componentInstance;
    return { fixture, component, stateMock, prefsMock };
  }

  // ── Skip path (planningPrefsComplete = true) ────────────────────────────────

  it('emits complete on ngOnInit when planningPrefsComplete is already true', async () => {
    const { fixture, component } = await setup(true);
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    fixture.detectChanges(); // triggers ngOnInit
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  });

  it('does not render form content when planningPrefsComplete is true', async () => {
    const { fixture } = await setup(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.planning-prefs')).toBeNull();
  });

  // ── Render path (planningPrefsComplete = false) ─────────────────────────────

  it('does not emit complete on init when planningPrefsComplete is false', async () => {
    const { fixture, component } = await setup(false);
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    fixture.detectChanges();
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('renders form fields when planningPrefsComplete is false', async () => {
    const { fixture } = await setup(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.planning-prefs')).not.toBeNull();
    expect(el.querySelector('.segmented-control')).not.toBeNull();
    // Two day-row groups: week-start and planning-day
    const dayRows = el.querySelectorAll('.day-row');
    expect(dayRows.length).toBe(2);
    // 7 day pills in each row
    dayRows.forEach(row => {
      expect(row.querySelectorAll('.day-pill').length).toBe(7);
    });
  });

  it('defaults plan length to 14 days', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    expect(component.planLength()).toBe(14);
  });

  it('defaults week start to Monday (1)', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    expect(component.weekStart()).toBe(1);
  });

  it('defaults planning day to Monday (1)', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    expect(component.planningDay()).toBe(1);
  });

  it('selecting 4-week plan length updates signal', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    const btns: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.seg-btn');
    btns[2].click(); // "4 weeks" (index 2, value 28)
    expect(component.planLength()).toBe(28);
  });

  it('selecting week-start Sunday updates signal', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.day-row');
    const weekStartPills: NodeListOf<HTMLButtonElement> = rows[0].querySelectorAll('.day-pill');
    weekStartPills[0].click(); // Sunday = index 0, value 0
    expect(component.weekStart()).toBe(0);
  });

  it('shows footer note about Settings → Planning', async () => {
    const { fixture } = await setup(false);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Settings');
    expect(text).toContain('Planning');
  });

  // ── embedded save button ─────────────────────────────────────────────────────

  it('renders a Save & Continue button when prefs not complete', async () => {
    const { fixture } = await setup(false);
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent?.trim()).toContain('Save');
  });

  it('clicking the save button invokes patchPreferences', async () => {
    const { fixture, prefsMock } = await setup(false);
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    btn.click();
    expect(prefsMock.patchPreferences).toHaveBeenCalledTimes(1);
  });

  it('save button is disabled while isSaving is true', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    component.isSaving.set(true);
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.save-btn');
    expect(btn.disabled).toBeTrue();
  });

  it('save() is a no-op when isSaving is already true', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    component.isSaving.set(true);
    component.save();
    expect(prefsMock.patchPreferences).not.toHaveBeenCalled();
  });

  // ── save() ──────────────────────────────────────────────────────────────────

  it('save() calls patchPreferences with correct fields', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    component.planLength.set(28);
    component.weekStart.set(1);
    component.planningDay.set(0); // Sunday = 1 day before Monday
    component.save();
    expect(prefsMock.patchPreferences).toHaveBeenCalledWith({
      default_plan_length_days: 28,
      week_start_day: 1,
      planning_trigger_offset: -1,
      planning_time: '08:00:00',
    });
  });

  it('save() sends updated planning_time when signal is changed', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    component.planningTime.set('09:30');
    component.save();
    expect(prefsMock.patchPreferences).toHaveBeenCalledWith(
      jasmine.objectContaining({ planning_time: '09:30:00' })
    );
  });

  it('save() computes offset=0 when planningDay equals weekStart', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    component.weekStart.set(1); // Monday
    component.planningDay.set(1); // Monday
    component.save();
    expect(prefsMock.patchPreferences).toHaveBeenCalledWith(
      jasmine.objectContaining({ planning_trigger_offset: 0 })
    );
  });

  it('save() computes offset=-2 when planningDay is Saturday and weekStart is Monday', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    component.weekStart.set(1); // Monday
    component.planningDay.set(6); // Saturday
    component.save();
    expect(prefsMock.patchPreferences).toHaveBeenCalledWith(
      jasmine.objectContaining({ planning_trigger_offset: -2 })
    );
  });

  it('save() calls setPlanningPrefsComplete on success', async () => {
    const { fixture, component, stateMock } = await setup(false);
    fixture.detectChanges();
    component.save();
    expect(stateMock.setPlanningPrefsComplete).toHaveBeenCalledTimes(1);
  });

  it('save() calls computeAndSetPlanPeriod on success', async () => {
    const { fixture, component, stateMock } = await setup(false);
    fixture.detectChanges();
    component.save();
    expect(stateMock.computeAndSetPlanPeriod).toHaveBeenCalledTimes(1);
    expect(stateMock.computeAndSetPlanPeriod).toHaveBeenCalledWith(
      jasmine.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    );
  });

  it('save() emits complete on success', async () => {
    const { fixture, component } = await setup(false);
    fixture.detectChanges();
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    component.save();
    expect(completeSpy).toHaveBeenCalledOnceWith(undefined);
  });

  it('save() sets saveError to true when patchPreferences fails', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    const { throwError } = await import('rxjs');
    prefsMock.patchPreferences.and.returnValue(throwError(() => new Error('Network error')));
    component.save();
    expect(component.saveError()).toBeTrue();
  });

  it('save() does not emit complete when patchPreferences fails', async () => {
    const { fixture, component, prefsMock } = await setup(false);
    fixture.detectChanges();
    const { throwError } = await import('rxjs');
    prefsMock.patchPreferences.and.returnValue(throwError(() => new Error('Network error')));
    const completeSpy = jasmine.createSpy('complete');
    component.complete.subscribe(completeSpy);
    component.save();
    expect(completeSpy).not.toHaveBeenCalled();
  });
});
