import { Component, EventEmitter, Output, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { OnboardingTasksComponent } from './onboarding-tasks';
import { OnboardingStateService } from '../onboarding-state.service';
import { PlanningPrefsSubstepComponent } from '../shared/planning-prefs-substep/planning-prefs-substep';
import { DayTypesSubstepComponent } from './substeps/day-types-substep/day-types-substep';
import { RoutinesTasksSubstepComponent } from './substeps/routines-tasks-substep/routines-tasks-substep';
import { TaskPlacementReviewSubstepComponent } from './substeps/task-placement-review-substep/task-placement-review-substep';

// ── Stub components ─────────────────────────────────────────────────────────
// SpokeChromeComponent uses only RouterLink (no services), so we keep the real one.
// Substeps all have heavy service dependencies — stub them.

@Component({ selector: 'app-planning-prefs-substep', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
 template: '' })
class PlanningPrefsStub {
  @Output() complete = new EventEmitter<void>();
}

@Component({ selector: 'app-day-types-substep', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
 template: '' })
class DayTypesStub {
  @Output() complete = new EventEmitter<void>();
}

@Component({ selector: 'app-routines-tasks-substep', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
 template: '' })
class RoutinesTasksStub {
  @Output() complete = new EventEmitter<void>();
}

@Component({ selector: 'app-task-placement-review-substep', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
 template: '' })
class TaskPlacementStub {
  @Output() complete = new EventEmitter<void>();
}

// ── State mock ───────────────────────────────────────────────────────────────

function makeStateMock(planningPrefsComplete: boolean) {
  const prefsCompleteSignal = signal(planningPrefsComplete);
  return {
    planningPrefsComplete: prefsCompleteSignal.asReadonly(),
  };
}

// ── Setup helper ─────────────────────────────────────────────────────────────

async function setup(planningPrefsComplete: boolean) {
  const stateMock = makeStateMock(planningPrefsComplete);

  await TestBed.configureTestingModule({
    imports: [OnboardingTasksComponent],
    providers: [
      { provide: OnboardingStateService, useValue: stateMock },
      provideRouter([]),
    ],
  })
    .overrideComponent(OnboardingTasksComponent, {
      remove: { imports: [PlanningPrefsSubstepComponent, DayTypesSubstepComponent, RoutinesTasksSubstepComponent, TaskPlacementReviewSubstepComponent] },
      add: { imports: [PlanningPrefsStub, DayTypesStub, RoutinesTasksStub, TaskPlacementStub] },
    })
    .compileComponents();

  const fixture: ComponentFixture<OnboardingTasksComponent> =
    TestBed.createComponent(OnboardingTasksComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { fixture, component, stateMock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OnboardingTasksComponent', () => {

  // ── 1. Initial substep — planningPrefsComplete = false ──────────────────────

  it('starts at planning-prefs when planningPrefsComplete is false', async () => {
    const { component } = await setup(false);
    expect(component.activeSubstep()).toBe('planning-prefs');
  });

  // ── 2. Initial substep — planningPrefsComplete = true ───────────────────────

  it('starts at schedule-types when planningPrefsComplete is true', async () => {
    const { component } = await setup(true);
    expect(component.activeSubstep()).toBe('schedule-types');
  });

  // ── 3. totalDotSteps ────────────────────────────────────────────────────────

  it('totalDotSteps() is 4 when planningPrefsComplete is false', async () => {
    const { component } = await setup(false);
    expect(component.totalDotSteps()).toBe(4);
  });

  it('totalDotSteps() is 3 when planningPrefsComplete is true', async () => {
    const { component } = await setup(true);
    expect(component.totalDotSteps()).toBe(3);
  });

  // ── 4. currentDotStep ───────────────────────────────────────────────────────

  it('currentDotStep() is 1 on planning-prefs (first step, prefs not complete)', async () => {
    const { component } = await setup(false);
    expect(component.activeSubstep()).toBe('planning-prefs');
    expect(component.currentDotStep()).toBe(1);
  });

  it('currentDotStep() is 2 on schedule-types when prefs not complete', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('schedule-types');
    expect(component.currentDotStep()).toBe(2);
  });

  it('currentDotStep() is 1 on schedule-types when prefs complete (first visible step)', async () => {
    const { component } = await setup(true);
    expect(component.activeSubstep()).toBe('schedule-types');
    expect(component.currentDotStep()).toBe(1);
  });

  it('currentDotStep() is 3 on routines-tasks when prefs not complete', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('routines-tasks');
    expect(component.currentDotStep()).toBe(3);
  });

  it('currentDotStep() is 4 on task-placement when prefs not complete', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('task-placement');
    expect(component.currentDotStep()).toBe(4);
  });

  // ── 5. onSubstepComplete advances to next substep ───────────────────────────

  it('onSubstepComplete() advances from planning-prefs to schedule-types', async () => {
    const { component } = await setup(false);
    expect(component.activeSubstep()).toBe('planning-prefs');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('schedule-types');
  });

  it('onSubstepComplete() advances from schedule-types to routines-tasks', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('schedule-types');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('routines-tasks');
  });

  it('onSubstepComplete() advances from routines-tasks to task-placement', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('routines-tasks');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('task-placement');
  });

  it('onSubstepComplete() on task-placement does not change activeSubstep', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('task-placement');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('task-placement');
  });

  // ── 6. onBack() on schedule-types when prefs NOT complete ───────────────────

  it('onBack() on schedule-types goes to planning-prefs when prefs not complete', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('schedule-types');
    component.onBack();
    expect(component.activeSubstep()).toBe('planning-prefs');
  });

  // ── 7. onBack() on schedule-types when prefs complete ───────────────────────

  it('onBack() on schedule-types navigates to /onboarding when prefs complete', async () => {
    const { component } = await setup(true);
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    component.onBack();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  // ── 8. onBack() on planning-prefs navigates to hub ──────────────────────────

  it('onBack() on planning-prefs navigates to /onboarding', async () => {
    const { component } = await setup(false);
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    expect(component.activeSubstep()).toBe('planning-prefs');
    component.onBack();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  // ── 9. Renders SpokeChromeComponent with correct title ──────────────────────

  it('renders app-spoke-chrome element', async () => {
    const { fixture } = await setup(false);
    const el = fixture.nativeElement.querySelector('app-spoke-chrome');
    expect(el).toBeTruthy();
  });

  // ── 10. Shows correct substep based on activeSubstep() ──────────────────────

  it('renders app-planning-prefs-substep when activeSubstep is planning-prefs', async () => {
    const { fixture, component } = await setup(false);
    expect(component.activeSubstep()).toBe('planning-prefs');
    const el = fixture.nativeElement.querySelector('app-planning-prefs-substep');
    expect(el).toBeTruthy();
  });

  it('renders app-day-types-substep when activeSubstep is schedule-types', async () => {
    const { fixture, component } = await setup(false);
    component.activeSubstep.set('schedule-types');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('app-day-types-substep');
    expect(el).toBeTruthy();
  });

  it('renders app-routines-tasks-substep when activeSubstep is routines-tasks', async () => {
    const { fixture, component } = await setup(false);
    component.activeSubstep.set('routines-tasks');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('app-routines-tasks-substep');
    expect(el).toBeTruthy();
  });

  it('renders app-task-placement-review-substep when activeSubstep is task-placement', async () => {
    const { fixture, component } = await setup(false);
    component.activeSubstep.set('task-placement');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('app-task-placement-review-substep');
    expect(el).toBeTruthy();
  });

  // ── chrome footer continue button ────────────────────────────────────────────────────

  it('renders footer continue button when on planning-prefs substep', async () => {
    const { fixture, component } = await setup(false);
    component.activeSubstep.set('planning-prefs');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-continue');
    expect(btn).not.toBeNull();
  });

  it('hides footer continue button on non-planning-prefs substeps', async () => {
    const { fixture, component } = await setup(false);
    component.activeSubstep.set('schedule-types');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-continue');
    expect(btn).toBeNull();
  });

  // ── Additional onBack() navigation tests ────────────────────────────────────

  it('onBack() on routines-tasks goes to schedule-types', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('routines-tasks');
    component.onBack();
    expect(component.activeSubstep()).toBe('schedule-types');
  });

  it('onBack() on task-placement goes to routines-tasks', async () => {
    const { component } = await setup(false);
    component.activeSubstep.set('task-placement');
    component.onBack();
    expect(component.activeSubstep()).toBe('routines-tasks');
  });
});
