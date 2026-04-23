import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SpokeChromeComponent } from '../shared/spoke-chrome/spoke-chrome';
import { PlanningPrefsSubstepComponent } from '../shared/planning-prefs-substep/planning-prefs-substep';
import { ScheduleTypesSubstepComponent } from './substeps/schedule-types-substep/schedule-types-substep';
import { RoutinesTasksSubstepComponent } from './substeps/routines-tasks-substep/routines-tasks-substep';
import { TaskPlacementReviewSubstepComponent } from './substeps/task-placement-review-substep/task-placement-review-substep';
import { OnboardingStateService } from '../onboarding-state.service';

type TasksSubstep = 'planning-prefs' | 'schedule-types' | 'routines-tasks' | 'task-placement';

@Component({
  selector: 'app-onboarding-tasks',
  standalone: true,
  imports: [
    SpokeChromeComponent,
    PlanningPrefsSubstepComponent,
    ScheduleTypesSubstepComponent,
    RoutinesTasksSubstepComponent,
    TaskPlacementReviewSubstepComponent,
  ],
  template: `
    <app-spoke-chrome
      [title]="'Tasks & Routines'"
      [totalSteps]="totalDotSteps()"
      [currentStep]="currentDotStep()"
      (backClick)="onBack()"
      (continueClick)="onContinue()"
    >
      @switch (activeSubstep()) {
        @case ('planning-prefs') {
          <app-planning-prefs-substep
            #planningPrefsSubstep
            (complete)="onSubstepComplete()"
          />
        }
        @case ('schedule-types') {
          <app-schedule-types-substep (complete)="onSubstepComplete()" />
        }
        @case ('routines-tasks') {
          <app-routines-tasks-substep (complete)="onSubstepComplete()" />
        }
        @case ('task-placement') {
          <app-task-placement-review-substep (complete)="onSubstepComplete()" />
        }
      }
    </app-spoke-chrome>
  `,
})
export class OnboardingTasksComponent {
  private readonly stateService = inject(OnboardingStateService);
  private readonly router = inject(Router);

  /**
   * ViewChild reference to PlanningPrefsSubstepComponent.
   * The planning-prefs substep has no embedded save button; it relies on the
   * parent calling save() via ViewChild. The SpokeChromeComponent's footer
   * "Save & Continue →" button drives this for the planning-prefs step.
   * For all other substeps the substep has its own save button, so onContinue()
   * is a no-op there (the chrome footer button appears but is functionally
   * redundant — tracked for cleanup in a follow-up issue).
   */
  @ViewChild('planningPrefsSubstep')
  planningPrefsSubstep?: PlanningPrefsSubstepComponent;

  readonly activeSubstep = signal<TasksSubstep>(
    this.stateService.planningPrefsComplete() ? 'schedule-types' : 'planning-prefs'
  );

  readonly totalDotSteps = computed(() =>
    this.stateService.planningPrefsComplete() ? 3 : 4
  );

  readonly currentDotStep = computed(() => {
    const stepMap: TasksSubstep[] = this.stateService.planningPrefsComplete()
      ? ['schedule-types', 'routines-tasks', 'task-placement']
      : ['planning-prefs', 'schedule-types', 'routines-tasks', 'task-placement'];
    const idx = stepMap.indexOf(this.activeSubstep());
    return idx + 1;
  });

  onContinue(): void {
    // Only the planning-prefs substep relies on the chrome footer button for saving.
    // All other substeps embed their own "Save & Continue →" button.
    if (this.activeSubstep() === 'planning-prefs') {
      this.planningPrefsSubstep?.save();
    }
    // No-op for other substeps: their own save buttons drive progression.
  }

  onBack(): void {
    const current = this.activeSubstep();
    switch (current) {
      case 'planning-prefs':
        this.router.navigate(['/onboarding']);
        break;
      case 'schedule-types':
        if (this.stateService.planningPrefsComplete()) {
          this.router.navigate(['/onboarding']);
        } else {
          this.activeSubstep.set('planning-prefs');
        }
        break;
      case 'routines-tasks':
        this.activeSubstep.set('schedule-types');
        break;
      case 'task-placement':
        this.activeSubstep.set('routines-tasks');
        break;
    }
  }

  onSubstepComplete(): void {
    const current = this.activeSubstep();
    switch (current) {
      case 'planning-prefs':
        this.activeSubstep.set('schedule-types');
        break;
      case 'schedule-types':
        this.activeSubstep.set('routines-tasks');
        break;
      case 'routines-tasks':
        this.activeSubstep.set('task-placement');
        break;
      case 'task-placement':
        // Navigation to hub is handled by TaskPlacementReviewSubstep itself.
        // This case should never fire.
        break;
    }
  }
}
